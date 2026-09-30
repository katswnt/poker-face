//! Single-threaded bindings, not a browser admission layer. Run in a disposable Worker.
//! All math/export code is shared with the native bridge. On a panic/trap discard the entire
//! Worker/instance; Rust panics abort and cannot safely be recovered with a JS try/catch.
use solver_bridge::Session;
use wasm_bindgen::prelude::*;

fn js_error(message: String) -> JsValue {
    JsValue::from_str(&message)
}

fn json(value: &impl serde::Serialize) -> Result<String, JsValue> {
    serde_json::to_string(value).map_err(|error| js_error(error.to_string()))
}

/// Small JSON boundary: Spot v1 in, status/preview JSON during work, Result v1 only at finish.
/// `.free()` drops all live Rust state (cancellation between calls); it does not shrink WASM
/// linear memory. Destroy the Worker to reclaim the instance's high-water memory allocation.
#[wasm_bindgen]
pub struct SolverSession {
    inner: Option<Session>,
}

impl SolverSession {
    fn session(&mut self) -> Result<&mut Session, JsValue> {
        self.inner
            .as_mut()
            .ok_or_else(|| js_error("session already finished".into()))
    }
}

#[wasm_bindgen]
impl SolverSession {
    #[wasm_bindgen(constructor)]
    pub fn new(spot: &[u8]) -> Result<SolverSession, JsValue> {
        // Match the native CLI's input-file bound before parsing. This is NOT an allocation
        // safety guarantee: a small menu can describe a very large game.
        if spot.len() > 64 * 1024 * 1024 {
            return Err(js_error("spot exceeds 64 MiB".into()));
        }
        Ok(Self {
            inner: Some(Session::new(spot).map_err(js_error)?),
        })
    }

    pub fn estimate(&mut self) -> Result<String, JsValue> {
        json(&self.session()?.estimate())
    }

    pub fn status(&mut self) -> Result<String, JsValue> {
        json(&self.session()?.status())
    }

    pub fn allocate(&mut self) -> Result<String, JsValue> {
        json(&self.session()?.allocate().map_err(js_error)?)
    }

    pub fn step(&mut self, count: f64) -> Result<String, JsValue> {
        // wasm-bindgen's u32 ABI otherwise silently wraps negatives/truncates fractions.
        if !count.is_finite() || count.fract() != 0.0 || count < 1.0 || count > u32::MAX as f64 {
            return Err(js_error("step count must be a positive u32 integer".into()));
        }
        json(&self.session()?.step(count as u32).map_err(js_error)?)
    }

    pub fn root_strategy(&mut self) -> Result<String, JsValue> {
        json(&self.session()?.root_strategy().map_err(js_error)?)
    }

    pub fn finish(&mut self) -> Result<String, JsValue> {
        if !self.session()?.is_done() {
            return Err(js_error(
                "cannot finish before the target or iteration limit is reached".into(),
            ));
        }
        let session = self.inner.take().expect("checked session");
        json(&session.finish().map_err(js_error)?)
    }
}

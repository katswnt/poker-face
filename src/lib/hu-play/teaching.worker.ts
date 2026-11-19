import { runTeachingRequest } from "./teaching-worker";
self.onmessage = (event: MessageEvent<unknown>) => runTeachingRequest(event.data, value => self.postMessage(value));

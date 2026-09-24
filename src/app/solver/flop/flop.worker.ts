import { evaluateFlopInspection, type FlopInspectionRequest } from "@/lib/solver/postflop/flop-library/worker";
const scope = self as unknown as { onmessage: ((event: MessageEvent<FlopInspectionRequest>) => void) | null; postMessage(value: unknown): void };
scope.onmessage = event => scope.postMessage(evaluateFlopInspection(event.data));

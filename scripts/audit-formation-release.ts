/** Release audit for the corrected direct-byte reproduction; original evidence stays frozen. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditCorrectedFormationExperiment } from "./reproduce-formation-libraries";
export { checkFormationObservation } from "./reproduce-formation-libraries";
export const auditFormationRelease = auditCorrectedFormationExperiment;
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(auditFormationRelease(), null, 2));

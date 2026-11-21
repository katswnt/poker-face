// Practice extensions are separate from the original shared drill contracts used by /play.
// The frozen play dependency surface stays unchanged; existing questions remain assignable.
import type { Answer as BaseAnswer, DrillType as BaseType, Question as BaseQuestion } from "./types";
import type { PushFoldDetail, PushFoldGrade } from "./push-fold/model";
import type { EquityRangeDetail } from "./equity-range/model";
export * from "./types";
export type AsyncDrillType = "solver" | "push-fold" | "equity-range";
export type DrillType = BaseType | "push-fold" | "equity-range";
export type Answer = BaseAnswer | {readonly kind: "push-fold"; readonly value: string;
  readonly options: readonly {id: string; label: string}[];
  readonly grades: Readonly<Record<string, PushFoldGrade>>};
export type AnswerKind = Answer["kind"];
export type Question = Omit<BaseQuestion, "type" | "answer"> & {
  readonly type: DrillType;
  readonly answer: Answer;
  readonly pushFold?: PushFoldDetail;
  readonly equityRange?: EquityRangeDetail;
};

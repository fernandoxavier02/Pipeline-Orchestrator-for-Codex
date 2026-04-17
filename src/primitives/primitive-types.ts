import { z } from "zod";

export const QuestionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["confirmation", "choice", "freetext"]),
    prompt: z.string().min(1),
    options: z.array(z.string()).optional(),
    gateName: z.string().min(1),
  })
  .refine(
    (q) => q.type !== "choice" || (q.options !== undefined && q.options.length >= 2),
    { message: "choice questions require options (length >= 2)" },
  );

export type Question = z.infer<typeof QuestionSchema>;

export const ResponseSchema = z.object({
  questionId: z.string().min(1),
  raw: z.string(),
  parsed: z.unknown(),
  timestamp: z.string().datetime(),
});

export type Response = z.infer<typeof ResponseSchema>;

export const InteractionSchema = z.object({
  id: z.string().min(1),
  question: QuestionSchema,
  response: ResponseSchema.optional(),
  gateName: z.string().min(1),
});

export type Interaction = z.infer<typeof InteractionSchema>;

export const PlanSessionSchema = z.object({
  id: z.string().min(1),
  startTime: z.string().datetime(),
  readOnly: z.boolean(),
  writesAttempted: z.number().int().nonnegative(),
  endTime: z.string().datetime().optional(),
});

export type PlanSession = z.infer<typeof PlanSessionSchema>;

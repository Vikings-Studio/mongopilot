import { z } from "zod"
import type { VisualizationSpec } from "../shared/types"
import { parseAggregationPipeline } from "./aggregation-pipeline"

const seriesSchema = z.object({
  field: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(80),
}).strict()

const visualizationSpecSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(240).default(""),
  chartType: z.enum(["bar", "line", "area", "pie", "scatter", "table"]),
  pipeline: z.array(z.record(z.unknown())).max(30),
  categoryField: z.string().trim().min(1).max(120),
  series: z.array(seriesSchema).min(1).max(4),
}).strict().superRefine((spec, context) => {
  if (spec.chartType === "pie" && spec.series.length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["series"], message: "Pie charts require exactly one series." })
  }
})

const forbiddenOperators = new Set(["$accumulator", "$function", "$where"])

function containsForbiddenOperator(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenOperator)
  if (value === null || typeof value !== "object") return false
  return Object.entries(value).some(([key, child]) => forbiddenOperators.has(key) || containsForbiddenOperator(child))
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced) return fenced
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("The AI did not return a visualization JSON object.")
  return text.slice(start, end + 1)
}

export function parseVisualizationSpec(value: unknown): VisualizationSpec {
  const parsed = visualizationSpecSchema.parse(value)
  parseAggregationPipeline(JSON.stringify(parsed.pipeline))
  if (containsForbiddenOperator(parsed.pipeline)) throw new Error("Visualization pipelines cannot use server-side JavaScript operators.")
  return parsed
}

export function parseVisualizationReply(text: string): VisualizationSpec {
  try {
    return parseVisualizationSpec(JSON.parse(extractJson(text)))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("The AI returned invalid visualization JSON.")
    if (error instanceof z.ZodError) {
      const issue = error.issues[0]
      throw new Error(`The AI returned an invalid visualization specification${issue ? `: ${issue.message}` : "."}`)
    }
    throw error
  }
}

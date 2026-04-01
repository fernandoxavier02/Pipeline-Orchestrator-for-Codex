export function renderCloseout(input: {
  status: "go" | "no-go";
  batches: Array<{ name: string }>;
}) {
  return [
    `Final status: ${input.status}`,
    `Batches executed: ${input.batches.map((batch) => batch.name).join(", ")}`,
  ].join("\n");
}

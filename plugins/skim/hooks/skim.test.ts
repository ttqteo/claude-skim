import { expect, test } from "claude-code/testing";
import { layout, parseMarks } from "./highlight-core";

// the marked texts a reply draws highlighted
function drawn(reply: string): string[] {
    const { clean, marks } = parseMarks(reply);
    return layout(clean, marks, true).flatMap((s) =>
        s.kind === "line" ? s.runs.filter((r) => r.isMarked).map((r) => r.text) : []
    );
}

test("a mark in a table row leaves the marks after it drawn", async () => {
    expect(drawn("| a | ==In a cell.== |\n|---|---|\n\n==Later sentence.== More text.")).toEqual(["Later sentence."]);
});

test("marks outside tables draw in order", async () => {
    expect(drawn("==First point.== Then more.\n\n- ==A listed point.== tail")).toEqual(["First point.", "A listed point."]);
});

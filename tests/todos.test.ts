import { describe, expect, it } from "vitest";
import { normalizeTodoPhases, todoProgress } from "../src/lib/todos";

describe("normalizeTodoPhases", () => {
  it("passes through upstream wire shapes", () => {
    const phases = [
      {
        name: "Evaluation",
        tasks: [
          { content: "Map the read tool surface", status: "in_progress" },
          { content: "Write tests", status: "pending" },
          { content: "Deploy", status: "blocked", blocker: "waiting for CI" },
        ],
      },
    ];
    expect(normalizeTodoPhases(phases)).toEqual(phases);
  });

  it("strips legacy id fields the wire never carries", () => {
    expect(normalizeTodoPhases([{ id: "phase-1", name: "Todos", tasks: [{ id: "t1", content: "x", status: "pending" }] }]))
      .toEqual([{ name: "Todos", tasks: [{ content: "x", status: "pending" }] }]);
  });

  it("drops junk entries and rejects non-arrays", () => {
    expect(normalizeTodoPhases(null)).toEqual([]);
    expect(normalizeTodoPhases("nope")).toEqual([]);
    expect(
      normalizeTodoPhases([
        null,
        42,
        { tasks: [] }, // no name
        { name: "ok", tasks: [{ content: "fine", status: "completed" }, { content: 7, status: "pending" }] },
        { name: "bad-status", tasks: [{ content: "x", status: "on-fire" }] },
      ]),
    ).toEqual([{ name: "ok", tasks: [{ content: "fine", status: "completed" }] }]);
  });

  it("keeps empty phases (a dropped-everything snapshot)", () => {
    expect(normalizeTodoPhases([{ name: "Todos", tasks: [] }])).toEqual([{ name: "Todos", tasks: [] }]);
  });
});

describe("todoProgress", () => {
  it("counts completed tasks across phases; abandoned/blocked are not done", () => {
    const phases = normalizeTodoPhases([
      {
        name: "p1",
        tasks: [
          { content: "a", status: "completed" },
          { content: "b", status: "in_progress" },
        ],
      },
      {
        name: "p2",
        tasks: [
          { content: "c", status: "completed" },
          { content: "d", status: "abandoned" },
          { content: "e", status: "blocked" },
        ],
      },
    ]);
    expect(todoProgress(phases)).toEqual({ done: 2, total: 5 });
  });

  it("is zero on empty input", () => {
    expect(todoProgress([])).toEqual({ done: 0, total: 0 });
  });
});

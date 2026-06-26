import { describe, expect, it } from "vitest";
import { reviewStoryGraph } from "../interactive-film/validation.js";
import { StoryGraphSchema, type StoryGraph } from "../interactive-film/graph-schema.js";
const g = (over: Record<string, unknown>): StoryGraph => StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "T", variables: [], nodes: [], endings: [], ...over });
const codes = (graph: StoryGraph) => reviewStoryGraph(graph).issues.map((i) => i.code);

describe("reviewStoryGraph new rules", () => {
  it("ENDING_UNREACHABLE: an ending no runtime path reaches", () => {
    const graph = g({
      variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", choices: [{ id: "a", text: "走", targetNodeId: "e2" }, { id: "b", text: "门", targetNodeId: "e1", condition: { var: "trust", op: ">=", value: 9 } }] },
        { id: "e1", type: "ending", choices: [] }, // gated by trust>=9, never reachable (trust starts 0, never written)
        { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "好", type: "good" }, { id: "b1", nodeId: "e2", title: "坏", type: "bad" }],
    });
    expect(codes(graph)).toContain("ENDING_UNREACHABLE");
  });

  it("LINEAR_GRAPH: start+normal nodes+ending but no branch node", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "n1" }] },
        { id: "n1", type: "normal", choices: [{ id: "c2", text: "continue", targetNodeId: "n2" }] },
        { id: "n2", type: "normal", choices: [{ id: "c3", text: "end", targetNodeId: "e" }] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "好", type: "good" }],
    });
    expect(codes(graph)).toContain("LINEAR_GRAPH");
  });

  it("ISOLATED_NODE: a non-start node with no incoming edge", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
        { id: "e", type: "ending", choices: [] },
        { id: "orphan", type: "normal", choices: [] }, // nothing points to it
      ],
      endings: [{ id: "g1", nodeId: "e", title: "好", type: "good" }],
    });
    const issue = reviewStoryGraph(graph).issues.find((i) => i.code === "ISOLATED_NODE");
    expect(issue?.nodeIds).toContain("orphan");
  });

  it("ENDING_UNREACHABLE: gated ending yields exactly that code and NOT also GATED_UNREACHABLE", () => {
    const graph = g({
      variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", choices: [{ id: "a", text: "走", targetNodeId: "e2" }, { id: "b", text: "门", targetNodeId: "e1", condition: { var: "trust", op: ">=", value: 9 } }] },
        { id: "e1", type: "ending", choices: [] }, // gated by trust>=9, never reachable
        { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "好", type: "good" }, { id: "b1", nodeId: "e2", title: "坏", type: "bad" }],
    });
    const c = codes(graph);
    expect(c).toContain("ENDING_UNREACHABLE");
    expect(c).not.toContain("GATED_UNREACHABLE"); // Fix 1: ending deduplicated
    expect(c).not.toContain("ISOLATED_NODE");     // Fix 1: ending deduplicated
  });

  it("GATED_UNREACHABLE: normal node edge-reachable but behind an always-false condition", () => {
    const graph = g({
      variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
      nodes: [
        { id: "s", type: "start", choices: [
          { id: "a", text: "go", targetNodeId: "mid" },
          { id: "b", text: "unlock", targetNodeId: "locked", condition: { var: "trust", op: ">=", value: 9 } },
        ] },
        { id: "mid", type: "normal", choices: [{ id: "c", text: "end", targetNodeId: "e" }] },
        { id: "locked", type: "normal", choices: [{ id: "d", text: "end", targetNodeId: "e" }] }, // trust never written → never reachable at runtime
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "好", type: "good" }],
    });
    const c = codes(graph);
    expect(c).toContain("GATED_UNREACHABLE");
    expect(c).not.toContain("ENDING_UNREACHABLE"); // ending "e" IS reachable via mid
  });

  it("ILLUSORY_BRANCH: branch node whose choices all target the same node with no effects", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "branch" }] },
        { id: "branch", type: "normal", choices: [
          { id: "c1", text: "选A", targetNodeId: "e" },
          { id: "c2", text: "选B", targetNodeId: "e" }, // same target, no effects
        ] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "好", type: "good" }],
    });
    expect(codes(graph)).toContain("ILLUSORY_BRANCH");
  });

  it("LONG_LINEAR_CHAIN: chain of 5 single-choice normal nodes fires", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c0", text: "go", targetNodeId: "n1" }] },
        { id: "n1", type: "normal", choices: [{ id: "c1", text: "next", targetNodeId: "n2" }] },
        { id: "n2", type: "normal", choices: [{ id: "c2", text: "next", targetNodeId: "n3" }] },
        { id: "n3", type: "normal", choices: [{ id: "c3", text: "next", targetNodeId: "n4" }] },
        { id: "n4", type: "normal", choices: [{ id: "c4", text: "next", targetNodeId: "n5" }] },
        { id: "n5", type: "normal", choices: [{ id: "c5", text: "end", targetNodeId: "e" }] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "好", type: "good" }],
    });
    expect(codes(graph)).toContain("LONG_LINEAR_CHAIN");
  });

  it("LONG_LINEAR_CHAIN: chain of 4 single-choice normal nodes does NOT fire", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", choices: [{ id: "c0", text: "go", targetNodeId: "n1" }] },
        { id: "n1", type: "normal", choices: [{ id: "c1", text: "next", targetNodeId: "n2" }] },
        { id: "n2", type: "normal", choices: [{ id: "c2", text: "next", targetNodeId: "n3" }] },
        { id: "n3", type: "normal", choices: [{ id: "c3", text: "next", targetNodeId: "n4" }] },
        { id: "n4", type: "normal", choices: [{ id: "c4", text: "end", targetNodeId: "e" }] },
        { id: "e", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e", title: "好", type: "good" }],
    });
    expect(codes(graph)).not.toContain("LONG_LINEAR_CHAIN");
  });

  it("clean branching graph → none of the new codes", () => {
    const graph = g({
      nodes: [
        { id: "s", type: "start", imageSlot: { prompt: "p", assetRef: "x" }, choices: [{ id: "a", text: "A", targetNodeId: "e1" }, { id: "b", text: "B", targetNodeId: "e2" }] },
        { id: "e1", type: "ending", choices: [] }, { id: "e2", type: "ending", choices: [] },
      ],
      endings: [{ id: "g1", nodeId: "e1", title: "好", type: "good" }, { id: "b1", nodeId: "e2", title: "坏", type: "bad" }],
    });
    const c = codes(graph);
    for (const code of ["GATED_UNREACHABLE","ENDING_UNREACHABLE","ILLUSORY_BRANCH","LINEAR_GRAPH","ISOLATED_NODE","LONG_LINEAR_CHAIN"]) {
      expect(c).not.toContain(code);
    }
  });
});

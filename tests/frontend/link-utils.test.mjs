import test from "node:test";
import assert from "node:assert/strict";

import { linkAt } from "../../src/link-utils.js";

test("linkAt returns the link under the cursor", () => {
  const line = "See [[notes/day.txt]] for details.";
  assert.deepEqual(linkAt(line, 7), {
    path: "notes/day.txt",
    from: 4,
    to: 21,
  });
  assert.equal(linkAt(line, 0), null);
});

test("linkAt trims path and ignores empty or malformed links", () => {
  assert.equal(linkAt("[[  notes/day.txt  ]]", 5).path, "notes/day.txt");
  assert.equal(linkAt("[[]]", 2), null);
  assert.equal(linkAt("[[notes/day.txt", 5), null);
});

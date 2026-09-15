import * as Y from 'yjs';
import assert from 'assert';

console.log('=== Starting Test Suite: Phase 8 (RelativePosition Comments) ===\n');

const doc = new Y.Doc();
const yText = doc.getText('monaco');
const commentsMap = doc.getMap('comments');

// 1. Initial code: 4 lines
const initialCode = `function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}
`;

doc.transact(() => {
  yText.insert(0, initialCode);
});

// Let's anchor a comment on line 4: "total += item.price;"
const targetSearch = 'total += item.price;';
const targetOffset = yText.toString().indexOf(targetSearch);
assert(targetOffset !== -1, 'Target text not found');

// Compute line number in initial text (0-indexed line count + 1)
const initialLinesBefore = yText.toString().slice(0, targetOffset).split('\n').length;
console.log(`[Phase 8] Initial comment anchored at char offset ${targetOffset}, line ${initialLinesBefore}`);
assert.strictEqual(initialLinesBefore, 4, 'Initial line should be 4');

// Create RelativePosition
const relPos = Y.createRelativePositionFromTypeIndex(yText, targetOffset);

// Store comment in Y.Map
const threadId = 'thread-1';
commentsMap.set(threadId, {
  id: threadId,
  relPos,
  initialLine: initialLinesBefore,
  comments: [
    {
      id: 'c1',
      author: 'Bob (Reviewer)',
      role: 'commenter',
      text: 'Consider checking if item.price is non-negative.',
    },
  ],
});

// 2. Now simulate user or agent inserting 3 new lines ABOVE the comment!
console.log('[Phase 8] Inserting 3 new lines at the top of the file...');
doc.transact(() => {
  const newHeader = '// Added copyright notice\n// Licensed under MIT\n// Author: GlassCode Team\n';
  yText.insert(0, newHeader);
});

// 3. Resolve the comment's RelativePosition against the modified Y.Doc
const storedThread = commentsMap.get(threadId);
const resolvedAbsPos = Y.createAbsolutePositionFromRelativePosition(storedThread.relPos, doc);

assert(resolvedAbsPos !== null, 'Failed to resolve RelativePosition');
const shiftedCharOffset = resolvedAbsPos.index;
const shiftedLinesBefore = yText.toString().slice(0, shiftedCharOffset).split('\n').length;

console.log(`[Phase 8] Shifted comment char offset: ${shiftedCharOffset}, line ${shiftedLinesBefore}`);

// The comment should now be at line 4 + 3 = 7!
assert.strictEqual(shiftedLinesBefore, 7, 'Comment did not shift to line 7 after inserting 3 lines!');

// Verify the text at that position is still the exact target string
const snippetAtPosition = yText.toString().slice(shiftedCharOffset, shiftedCharOffset + targetSearch.length);
assert.strictEqual(snippetAtPosition, targetSearch, 'Comment target string mismatch after shift');

console.log(`[Phase 8] Text at resolved position: "${snippetAtPosition}"`);
console.log('✓ Phase 8 Acceptance Test PASSED: RelativePosition accurately tracked shifted line across edits!');
console.log('\n=== ALL PHASE 8 CRDT ANCHORING ACCEPTANCE TESTS PASSED! ===');

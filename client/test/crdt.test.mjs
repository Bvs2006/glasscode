import * as Y from 'yjs';
import assert from 'assert';

console.log('Testing Phase 2 CRDT in-memory operations...');

const doc = new Y.Doc();
const yText = doc.getText('monaco');

// 1. Initial insert
doc.transact(() => {
  yText.insert(0, 'console.log("Hello CRDT");');
});

assert.strictEqual(yText.toString(), 'console.log("Hello CRDT");', 'Initial insert failed');

// 2. Observer notification
let observedChange = '';
yText.observe((event) => {
  observedChange = yText.toString();
});

// 3. Subsequent transaction
doc.transact(() => {
  yText.delete(13, 10);
  yText.insert(13, 'World');
});

assert.strictEqual(yText.toString(), 'console.log("World");', 'Edit transaction failed');
assert.strictEqual(observedChange, 'console.log("World");', 'Observer did not receive update');

console.log('CRDT in-memory test passed successfully!');

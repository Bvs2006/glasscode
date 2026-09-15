/**
 * Default starter code samples for server-side room bootstrapping.
 * Seeded exactly once per room when the room is first created by the server.
 */
export const DEFAULT_SAMPLES = {
  javascript: `// GlassCode - JavaScript Collaborative Sample
import { useState, useEffect } from 'react';

/**
 * Calculates Fibonacci sequence up to n numbers
 * @param {number} n
 * @returns {number[]}
 */
function fibonacci(n) {
  if (n <= 0) return [];
  if (n === 1) return [0];
  
  const seq = [0, 1];
  for (let i = 2; i < n; i++) {
    seq.push(seq[i - 1] + seq[i - 2]);
  }
  return seq;
}

const terms = 10;
console.log(\`Fibonacci first \${terms} numbers:\`, fibonacci(terms));
`,
  python: `# GlassCode - Python Collaborative Sample
import sys
from typing import List

def quicksort(arr: List[int]) -> List[int]:
    """Sorts an array of integers using QuickSort algorithm."""
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)

numbers = [38, 27, 43, 3, 9, 82, 10]
print(f"Original: {numbers}")
print(f"Sorted:   {quicksort(numbers)}")
`,
};

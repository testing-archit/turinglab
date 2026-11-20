'use strict';
/** Bundled template machines. Every one is exercised by test/templates.test.js. */

const t = (from, read, to, write, dir) => ({ from, read, to, write, dir });

const templates = [
  {
    key: 'binary-incrementer',
    name: 'Binary Incrementer',
    description: 'Adds 1 to a binary number. Scans right to the end of the input, then propagates the carry leftwards, turning trailing 1s into 0s until a 0 or blank absorbs the carry.',
    inputAlphabet: ['0', '1'], tapeAlphabet: ['0', '1', '_'], blank: '_',
    states: ['q0', 'q1', 'qa', 'qr'], initialState: 'q0', acceptState: 'qa', rejectState: 'qr',
    transitions: [
      t('q0', '0', 'q0', '0', 'R'), t('q0', '1', 'q0', '1', 'R'), t('q0', '_', 'q1', '_', 'L'),
      t('q1', '1', 'q1', '0', 'L'), t('q1', '0', 'qa', '1', 'S'), t('q1', '_', 'qa', '1', 'S'),
    ],
    samples: [
      { input: '101', status: 'ACCEPTED', output: '110' },
      { input: '111', status: 'ACCEPTED', output: '1000' },
      { input: '0', status: 'ACCEPTED', output: '1' },
      { input: '1011', status: 'ACCEPTED', output: '1100' },
    ],
  },
  {
    key: 'unary-addition',
    name: 'Unary Addition',
    description: 'Computes m + n in unary for input 1^m+1^n. Replaces "+" with 1, walks to the end, and erases the final 1. Inputs without "+" are rejected.',
    inputAlphabet: ['1', '+'], tapeAlphabet: ['1', '+', '_'], blank: '_',
    states: ['q0', 'q1', 'q2', 'qa', 'qr'], initialState: 'q0', acceptState: 'qa', rejectState: 'qr',
    transitions: [
      t('q0', '1', 'q0', '1', 'R'), t('q0', '+', 'q1', '1', 'R'), t('q0', '_', 'qr', '_', 'S'),
      t('q1', '1', 'q1', '1', 'R'), t('q1', '_', 'q2', '_', 'L'),
      t('q2', '1', 'qa', '_', 'S'),
    ],
    samples: [
      { input: '11+111', status: 'ACCEPTED', output: '11111' },
      { input: '1+1', status: 'ACCEPTED', output: '11' },
      { input: '+', status: 'ACCEPTED', output: '' },
      { input: '111', status: 'REJECTED' },
    ],
  },
  {
    key: 'palindrome-checker',
    name: 'Palindrome Checker',
    description: 'Accepts binary palindromes. Erases the leftmost symbol, remembers it in the state, runs to the right end and checks the rightmost symbol matches, erasing it; repeats until the tape is empty.',
    inputAlphabet: ['0', '1'], tapeAlphabet: ['0', '1', '_'], blank: '_',
    states: ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'qa', 'qr'], initialState: 'q0', acceptState: 'qa', rejectState: 'qr',
    transitions: [
      t('q0', '0', 'q1', '_', 'R'), t('q0', '1', 'q2', '_', 'R'), t('q0', '_', 'qa', '_', 'S'),
      t('q1', '0', 'q1', '0', 'R'), t('q1', '1', 'q1', '1', 'R'), t('q1', '_', 'q3', '_', 'L'),
      t('q2', '0', 'q2', '0', 'R'), t('q2', '1', 'q2', '1', 'R'), t('q2', '_', 'q4', '_', 'L'),
      t('q3', '0', 'q5', '_', 'L'), t('q3', '1', 'qr', '1', 'S'), t('q3', '_', 'qa', '_', 'S'),
      t('q4', '1', 'q5', '_', 'L'), t('q4', '0', 'qr', '0', 'S'), t('q4', '_', 'qa', '_', 'S'),
      t('q5', '0', 'q5', '0', 'L'), t('q5', '1', 'q5', '1', 'L'), t('q5', '_', 'q0', '_', 'R'),
    ],
    samples: [
      { input: '10101', status: 'ACCEPTED' },
      { input: '10100', status: 'REJECTED' },
      { input: '0110', status: 'ACCEPTED' },
      { input: '', status: 'ACCEPTED' },
      { input: '01', status: 'REJECTED' },
    ],
  },
  {
    key: 'binary-subtractor',
    name: 'Binary Subtractor',
    description: 'Computes a − b for input "a-b" (binary, a ≥ b) by repeatedly decrementing b and a together until b reaches zero, then erasing "-b". Rejects when a < b (a underflows) or when "-" is missing.',
    inputAlphabet: ['0', '1', '-'], tapeAlphabet: ['0', '1', '-', '_'], blank: '_',
    states: ['q0', 'decB', 'toA', 'decA', 'back', 'erase', 'qa', 'qr'], initialState: 'q0', acceptState: 'qa', rejectState: 'qr',
    transitions: [
      t('q0', '0', 'q0', '0', 'R'), t('q0', '1', 'q0', '1', 'R'), t('q0', '-', 'q0', '-', 'R'), t('q0', '_', 'decB', '_', 'L'),
      t('decB', '0', 'decB', '1', 'L'), t('decB', '1', 'toA', '0', 'L'), t('decB', '-', 'erase', '_', 'R'), t('decB', '_', 'qr', '_', 'S'),
      t('toA', '0', 'toA', '0', 'L'), t('toA', '1', 'toA', '1', 'L'), t('toA', '-', 'decA', '-', 'L'),
      t('decA', '0', 'decA', '1', 'L'), t('decA', '1', 'back', '0', 'R'), t('decA', '_', 'qr', '_', 'S'),
      t('back', '0', 'back', '0', 'R'), t('back', '1', 'back', '1', 'R'), t('back', '-', 'back', '-', 'R'), t('back', '_', 'decB', '_', 'L'),
      t('erase', '1', 'erase', '_', 'R'), t('erase', '_', 'qa', '_', 'S'),
    ],
    samples: [
      { input: '110-11', status: 'ACCEPTED', output: '011' },
      { input: '101-1', status: 'ACCEPTED', output: '100' },
      { input: '1000-1', status: 'ACCEPTED', output: '0111' },
      { input: '11-101', status: 'REJECTED' },
    ],
  },
  {
    key: 'even-ones',
    name: 'Even Number of 1s',
    description: 'Recognizes binary strings containing an even number of 1s. Two states track parity while scanning right; the blank at the end decides acceptance.',
    inputAlphabet: ['0', '1'], tapeAlphabet: ['0', '1', '_'], blank: '_',
    states: ['even', 'odd', 'qa', 'qr'], initialState: 'even', acceptState: 'qa', rejectState: 'qr',
    transitions: [
      t('even', '0', 'even', '0', 'R'), t('even', '1', 'odd', '1', 'R'), t('even', '_', 'qa', '_', 'S'),
      t('odd', '0', 'odd', '0', 'R'), t('odd', '1', 'even', '1', 'R'), t('odd', '_', 'qr', '_', 'S'),
    ],
    samples: [
      { input: '1001', status: 'ACCEPTED' },
      { input: '1011', status: 'REJECTED' },
      { input: '', status: 'ACCEPTED' },
      { input: '0000', status: 'ACCEPTED' },
    ],
  },
  {
    key: 'string-reversal',
    name: 'String Reversal',
    description: 'Reverses a string over {a, b}. Places a # marker after the input, then repeatedly marks the rightmost unmarked input symbol with X and copies it to the output area after #. Finally erases the X marks and #, leaving the reversed string.',
    inputAlphabet: ['a', 'b'], tapeAlphabet: ['a', 'b', 'X', '#', '_'], blank: '_',
    states: ['s0', 's1', 'ca', 'cb', 'back', 'clean', 'qa', 'qr'], initialState: 's0', acceptState: 'qa', rejectState: 'qr',
    transitions: [
      t('s0', 'a', 's0', 'a', 'R'), t('s0', 'b', 's0', 'b', 'R'), t('s0', '_', 's1', '#', 'L'),
      t('s1', 'X', 's1', 'X', 'L'), t('s1', 'a', 'ca', 'X', 'R'), t('s1', 'b', 'cb', 'X', 'R'), t('s1', '_', 'clean', '_', 'R'),
      t('ca', 'X', 'ca', 'X', 'R'), t('ca', '#', 'ca', '#', 'R'), t('ca', 'a', 'ca', 'a', 'R'), t('ca', 'b', 'ca', 'b', 'R'), t('ca', '_', 'back', 'a', 'L'),
      t('cb', 'X', 'cb', 'X', 'R'), t('cb', '#', 'cb', '#', 'R'), t('cb', 'a', 'cb', 'a', 'R'), t('cb', 'b', 'cb', 'b', 'R'), t('cb', '_', 'back', 'b', 'L'),
      t('back', 'a', 'back', 'a', 'L'), t('back', 'b', 'back', 'b', 'L'), t('back', '#', 's1', '#', 'L'),
      t('clean', 'X', 'clean', '_', 'R'), t('clean', '#', 'qa', '_', 'R'),
    ],
    samples: [
      { input: 'ab', status: 'ACCEPTED', output: 'ba' },
      { input: 'aab', status: 'ACCEPTED', output: 'baa' },
      { input: 'abbab', status: 'ACCEPTED', output: 'babba' },
      { input: '', status: 'ACCEPTED', output: '' },
    ],
  },
];

const getTemplate = (key) => templates.find((tp) => tp.key === key) || null;

module.exports = { templates, getTemplate };

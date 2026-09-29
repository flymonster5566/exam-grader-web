import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOcrFields } from './parseOcrFields.js'

test('parses labeled fields on separate lines', () => {
  assert.deepEqual(
    parseOcrFields('班級：三年甲班\n座號：12\n姓名：王小明'),
    {
      className: '三年甲班',
      seatNumber: '12',
      studentName: '王小明',
    },
  )
})

test('parses labeled fields on one line', () => {
  assert.deepEqual(
    parseOcrFields('班級:三年乙班 座號：08 姓名：陳小華'),
    {
      className: '三年乙班',
      seatNumber: '08',
      studentName: '陳小華',
    },
  )
})

test('does not infer fields without explicit labels and values', () => {
  assert.deepEqual(parseOcrFields('三年甲班 12 王小明'), {
    className: '—',
    seatNumber: '—',
    studentName: '—',
  })
  assert.deepEqual(parseOcrFields('班級： 座號： 姓名：'), {
    className: '—',
    seatNumber: '—',
    studentName: '—',
  })
})

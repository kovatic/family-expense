import assert from 'node:assert/strict'
import { test } from 'node:test'
import { looksSensitive } from '@/lib/import/sms'
import { matchesBank } from '@/lib/import/rules'

test('OTP and code messages are refused', () => {
  assert.ok(looksSensitive('Your OTP for transaction is 482913. Do not share it.'))
  assert.ok(looksSensitive('482913 is your one time password for SBI login'))
  assert.ok(looksSensitive('Verification code: 1234'))
})

test('transaction alerts with a safety disclaimer are allowed', () => {
  assert.ok(!looksSensitive('A/C X1234 debited by 450.00 on date 03Oct26 trf to SWIGGY Refno 612345678901. Never share your OTP.'))
})

test('SMS sender rules: SBI only', () => {
  assert.ok(matchesBank('SBI', 'sms:AD-SBIUPI', ''))
  assert.ok(matchesBank('SBI', 'sms:VM-SBIINB-S', ''))
  assert.ok(!matchesBank('HDFC', 'sms:AD-HDFCBK', ''), 'HDFC arrives by email; SMS would double count')
  assert.ok(!matchesBank('SBI', 'sms:AD-ICICIB', ''))
})

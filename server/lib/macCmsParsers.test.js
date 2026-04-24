import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractMacPlayerInfo,
  extractTokenFromHtml,
  parseResolveApiResponse,
  shouldTriggerFallback,
} from './macCmsParsers.js'

test('extractMacPlayerInfo parses mac_player_info from html', () => {
  const html = `
    <script>
      var mac_player_info = {"from":"ARTA","url":"abc123","encrypt":"1","id":"10"};
    </script>
  `
  const info = extractMacPlayerInfo(html)
  assert.equal(info.from, 'ARTA')
  assert.equal(info.url, 'abc123')
})

test('extractMacPlayerInfo parses mac_player_info without trailing semicolon', () => {
  const html = `
    <script>
      var mac_player_info = {"from":"ARTA","url":"abc456","encrypt":3,"id":"11"}</script>
  `
  const info = extractMacPlayerInfo(html)
  assert.equal(info.from, 'ARTA')
  assert.equal(info.url, 'abc456')
})

test('extractTokenFromHtml parses token from ec page', () => {
  const html = `<script>var config = { token: "tok_987" };</script>`
  assert.equal(extractTokenFromHtml(html), 'tok_987')
})

test('extractTokenFromHtml parses quoted json-style token key', () => {
  const html = `<script>let ConFig = {"token":"tok_json_123"};</script>`
  assert.equal(extractTokenFromHtml(html), 'tok_json_123')
})

test('parseResolveApiResponse returns m3u8 URL from json', () => {
  const payload = { code: 1, data: { url: 'https://cdn.example.com/video/index.m3u8' } }
  assert.equal(parseResolveApiResponse(payload), 'https://cdn.example.com/video/index.m3u8')
})

test('shouldTriggerFallback only on known primary failure signals', () => {
  assert.equal(
    shouldTriggerFallback({
      code: 1,
      output: 'ERROR: Unsupported URL: https://example.com',
    }),
    true,
  )
  assert.equal(
    shouldTriggerFallback({
      code: 1,
      output: 'some unknown error',
    }),
    false,
  )
  assert.equal(
    shouldTriggerFallback({
      code: 0,
      output: 'ok',
    }),
    false,
  )
})

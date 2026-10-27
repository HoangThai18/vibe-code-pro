// test/attachments.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentBlock, MAX_UPLOAD_BYTES, UnsupportedFileError } from '../src/ai/attachments';
import { extractIntakeForm } from '../src/ai/extract-intake';
import { fakeAnthropic, messageJson } from './helpers/fake-anthropic';
import { memoryUsage } from './helpers/memory-usage';

// 1×1 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

test('type from the bytes, not the name; only images and PDF; 5 MB cap', () => {
  assert.deepEqual(attachmentBlock(png), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } });
  assert.equal((attachmentBlock(Buffer.from('%PDF-1.7\n...')) as { type: string }).type, 'document');
  for (const bad of [Buffer.from('<html><script>'), Buffer.from('MZ\x90\x00'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_UPLOAD_BYTES)])]) {
    assert.throws(() => attachmentBlock(bad), UnsupportedFileError);
  }
});

test('intake form photo: image block then the instruction; structured result; bad file never reaches the API', async () => {
  const form = { fullName: 'Nguyễn Thị Lan', phone: '0912345678', birthday: '1990-05-02' };
  const { client, requests } = fakeAnthropic([messageJson(JSON.stringify(form))]);
  const usage = memoryUsage();
  assert.deepEqual(await extractIntakeForm({ client, usage: usage.store }, { tenantId: 'spa-a', userId: 'u1' }, png), form);
  const content = (requests[0]!.body as { messages: { content: { type: string }[] }[] }).messages[0]!.content;
  assert.deepEqual(content.map((b) => b.type), ['image', 'text']);
  assert.equal(usage.rows[0]!.feature, 'extract_intake');

  await assert.rejects(extractIntakeForm({ client, usage: usage.store }, { tenantId: 'spa-a', userId: 'u1' }, Buffer.from('GIF')),
    UnsupportedFileError);
  assert.equal(requests.length, 1);
});

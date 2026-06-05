import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAttachWithoutUpload,
  isReusableMediaStatus,
  requiresTempArtifactProof,
  shouldReprocessExistingMedia,
} from './import-policy';

test('owned ready or processing media can attach without upload', () => {
  assert.equal(canAttachWithoutUpload('ready', true), true);
  assert.equal(canAttachWithoutUpload('processing', true), true);
});

test('unowned media cannot attach from preflight without temp artifact proof', () => {
  assert.equal(canAttachWithoutUpload('ready', false), false);
  assert.equal(canAttachWithoutUpload('processing', false), false);
  assert.equal(requiresTempArtifactProof('ready', false), true);
  assert.equal(requiresTempArtifactProof('processing', false), true);
});

test('failed media is never reusable and must be reprocessed', () => {
  assert.equal(isReusableMediaStatus('failed'), false);
  assert.equal(canAttachWithoutUpload('failed', true), false);
  assert.equal(requiresTempArtifactProof('failed', false), false);
  assert.equal(shouldReprocessExistingMedia('failed'), true);
});

test('unknown legacy statuses fail closed', () => {
  assert.equal(isReusableMediaStatus('error'), false);
  assert.equal(isReusableMediaStatus(null), false);
  assert.equal(canAttachWithoutUpload('error', true), false);
  assert.equal(requiresTempArtifactProof('error', false), false);
});

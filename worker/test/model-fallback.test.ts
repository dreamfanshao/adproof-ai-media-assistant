import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryWithoutImages } from "../../agent/llm/model.js";

test("vision request retries as text when the provider cannot download an image", () => {
  assert.equal(shouldRetryWithoutImages(400, ".messages[1].image[0]: Failed to download image from https://example.invalid/a.webp"), true);
  assert.equal(shouldRetryWithoutImages(400, "image_url fetch failed"), true);
});

test("unrelated model errors do not silently drop images", () => {
  assert.equal(shouldRetryWithoutImages(401, "invalid api key"), false);
  assert.equal(shouldRetryWithoutImages(400, "response_format is invalid"), false);
});

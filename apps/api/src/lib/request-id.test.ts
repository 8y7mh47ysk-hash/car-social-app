import { describe, expect, it } from "vitest";

import { requestIdFor } from "./request-id.ts";

const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

describe("requestIdFor", () => {
  it.each([
    ["a UUID", "0f8fe8b8-4bd5-4f5b-9d8c-6f1f0b5a1a11"],
    ["a ULID", "01J9ZKX4Q8M7VYH2B3C4D5E6F7"],
    ["a nanoid", "V1StGXR8_Z5jdHi6B-myT"],
    ["32 hex characters (nginx)", "5f0c7a3b9e2d4c18a6b1f0e9d8c7b6a5"],
    ["an ID with a hyphenated suffix", "8a1b2c3d4e5f6789-LHR"],
    ["the shortest allowed ID (8 characters)", "abcd1234"],
    ["the longest allowed ID (64 characters)", "a".repeat(64)],
  ])("reuses a well-formed incoming ID: %s", (_name, id) => {
    expect(requestIdFor({ "x-request-id": id })).toBe(id);
  });

  it("generates a random UUID when there is no x-request-id header", () => {
    const first = requestIdFor({});
    const second = requestIdFor({});

    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(second).not.toBe(first);
  });

  it.each([
    ["empty", ""],
    ["too short (7 characters)", "abc1234"],
    ["too long (65 characters)", "a".repeat(65)],
    ["a space", "abcd 1234"],
    ["two IDs joined by Node.js from repeated headers", "abcd1234, efgh5678"],
    ["a line feed", "abcd1234\nforged log line"],
    ["a carriage return", "abcd1234\r"],
    ["a tab", "abcd\t1234"],
    ["a double quote", 'abcd"1234'],
    ["a slash", "abcd/1234"],
    ["a dot", "abcd.1234"],
    ["a colon", "abcd:1234"],
    ["non-ASCII letters", "abcdé1234"],
    ["a null byte", "abcd\u00001234"],
  ])("replaces a malformed incoming ID with a new UUID: %s", (_name, id) => {
    const result = requestIdFor({ "x-request-id": id });

    expect(result).toMatch(UUID_V4);
    expect(result).not.toBe(id);
  });

  it("replaces an ID that arrives as several header values", () => {
    expect(requestIdFor({ "x-request-id": ["abcd1234", "efgh5678"] })).toMatch(UUID_V4);
  });
});

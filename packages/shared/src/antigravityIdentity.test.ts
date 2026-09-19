import { describe, expect, it } from "vitest";
import {
  GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT,
  normalizeAntigravityModelId,
  sanitizePersonalCloudCodeProject,
} from "./antigravityIdentity.js";

describe("sanitizePersonalCloudCodeProject", () => {
  it("keeps a normal personal or managed project id", () => {
    expect(sanitizePersonalCloudCodeProject("my-gcp-project")).toBe("my-gcp-project");
    expect(sanitizePersonalCloudCodeProject("  managed-abc  ")).toBe("managed-abc");
  });

  it("drops empty values", () => {
    expect(sanitizePersonalCloudCodeProject(null)).toBeNull();
    expect(sanitizePersonalCloudCodeProject(undefined)).toBeNull();
    expect(sanitizePersonalCloudCodeProject("")).toBeNull();
    expect(sanitizePersonalCloudCodeProject("   ")).toBeNull();
  });

  it("drops Google's enterprise shared consumer project", () => {
    expect(sanitizePersonalCloudCodeProject(GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT)).toBeNull();
    expect(sanitizePersonalCloudCodeProject("aicode-consumers")).toBeNull();
  });
});

describe("normalizeAntigravityModelId", () => {
  it("strips the models/ prefix Cloud Code rejects", () => {
    expect(normalizeAntigravityModelId("models/gemini-3.1-pro-low")).toBe("gemini-3.1-pro-low");
  });

  it("maps bare gemini-3.1-pro to the tiered id daily knows", () => {
    expect(normalizeAntigravityModelId("gemini-3.1-pro")).toBe("gemini-3.1-pro-low");
    expect(normalizeAntigravityModelId("models/gemini-3.1-pro")).toBe("gemini-3.1-pro-low");
  });
});

import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { PasswordInput } from "@/components/ui/PasswordInput";

describe("PasswordInput Component (Accessibility & Show/Hide Toggle)", () => {
  it("renders with initial input type='password'", () => {
    const html = renderToString(
      <PasswordInput
        id="test-pwd"
        name="password"
        placeholder="Enter password"
        defaultValue="secretPass"
      />
    );

    expect(html).toContain('type="password"');
    expect(html).toContain('id="test-pwd"');
    expect(html).toContain('name="password"');
    expect(html).toContain('placeholder="Enter password"');
    expect(html).toContain('value="secretPass"');
  });

  it("renders toggle button with type='button' to prevent form submission", () => {
    const html = renderToString(<PasswordInput id="test-pwd" />);

    expect(html).toContain('type="button"');
  });

  it("renders accessible ARIA attributes in initial masked state", () => {
    const html = renderToString(<PasswordInput id="test-pwd" />);

    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("preserves custom className and wrapperClassName", () => {
    const html = renderToString(
      <PasswordInput
        id="test-pwd"
        className="custom-input-class"
        wrapperClassName="custom-wrapper-class"
      />
    );

    expect(html).toContain("custom-input-class");
    expect(html).toContain("custom-wrapper-class");
  });

  it("has displayName set to 'PasswordInput'", () => {
    expect(PasswordInput.displayName).toBe("PasswordInput");
  });
});


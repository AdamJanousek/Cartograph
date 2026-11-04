"use client";

import { useActionState } from "react";
import { analyseRepository, type AnalyseState } from "@/app/(workspace)/actions";

export function AnalyseForm() {
  const [state, action, pending] = useActionState<AnalyseState, FormData>(analyseRepository, {
    error: null,
    input: "",
  });

  return (
    <form action={action} className="border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <label htmlFor="repository-url" className="sr-only">
          Public GitHub repository
        </label>
        <input
          id="repository-url"
          name="url"
          type="text"
          required
          defaultValue={state.input}
          placeholder="github.com/owner/name"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={state.error !== null}
          aria-describedby={state.error ? "repository-url-error" : undefined}
          className="h-7 w-80 rounded-sm border border-border bg-surface px-2 font-mono text-[12px] outline-none placeholder:text-text-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-7 cursor-pointer rounded-sm bg-accent px-3 text-[12px] text-accent-text disabled:cursor-default disabled:opacity-60"
        >
          {pending ? "Starting…" : "Analyse"}
        </button>
      </div>
      {state.error && (
        <p id="repository-url-error" className="mt-1.5 text-[12px] text-text">
          {state.error}
        </p>
      )}
    </form>
  );
}

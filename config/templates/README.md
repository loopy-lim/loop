# Repo-owned task/prompt templates (G9) — canonical shape.

# A template is a Markdown prompt fragment the Lead copies and fills during
# task decomposition. Templates are documentation, not runtime code: no parser,
# no loop-core concept, no config key consumes this directory. A consuming repo
# copies the fragments it wants into `<repo>/.loop/templates/` (see
# docs/repo-conventions.md) or into its Loop config directory.

# Conventions:
# - one file per task shape, kebab-case names, `.example.md` suffix for examples
# - minimum sections: 요구사항 / 완료 조건 / Read-Write scope / 결과 요약 양식
# - completion conditions must never be empty (completion-contract invariant)
# - no model ids, endpoints, or secrets inside templates

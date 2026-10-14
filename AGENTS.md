# AGENTS.md

This repository reads only WWU's public class schedule and catalog
(Banner 9 Browse Classes), so agents may run its scripts.

- Keep each section's primary instructor (instructor of record) only.
  Banner also lists secondary instructors, who are often graduate teaching
  assistants; never store them, and never store e-mail addresses or Banner IDs.
- Never add per-student data of any kind.
  Section enrollment counts are the only enrollment data here.
- Escape every scraped or CSV-supplied string before it reaches `innerHTML`.
- Be gentle with Banner: keep the request delay, and fetch course
  descriptions only for courses missing from `data/raw/descriptions.json`.

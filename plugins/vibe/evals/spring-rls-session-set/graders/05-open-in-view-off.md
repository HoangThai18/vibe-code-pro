---
type: regex
target:
  source: file
  path: src/main/resources/application.properties
pattern: 'spring\.jpa\.open-in-view\s*=\s*false'
match: contains
---

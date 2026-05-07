# Library fixture

A pure JavaScript library with one exported function. Used by DoceoMenter to verify the "library" branch — no app to boot, only architecture diagrams and GitHub README screenshots.

## API

```js
import { slugify } from "doceomenter-fixture-library";
slugify("Hello, World!"); // "hello-world"
```

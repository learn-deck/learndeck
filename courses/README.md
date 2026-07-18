# Course packs

Every direct child directory is one LearnDeck course pack. A valid pack has a
`course.md` file and one or more ordered `modules/*.md` files. The DDD pack is
the included example; it can be removed or copied without changing the runner.

Create a new pack with:

```sh
bun run seed -- <course-id> "Course title"
```

Read [the course-pack standard](../docs/course-authoring.md) before authoring
or publishing a course.

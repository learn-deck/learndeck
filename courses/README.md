# Course packs

Every direct child directory is one LearnDeck course pack. A valid pack has a
`course.md` file and one or more ordered `modules/*.md` files.

This repository bundles exactly one pack: [`example-course`](example-course/course.md),
a small reference implementation of the format kept for documentation,
development, and tests. Real, learner-facing courses live in the public
catalogue at [learn-deck/courses](https://github.com/learn-deck/courses) and
sync into the app when `LEARNDECK_COURSE_REPOSITORY` is configured.

Create a new pack skeleton with:

```sh
bun run seed -- <course-id> "Course title"
```

Read [the course-pack standard](../docs/course-authoring.md) before authoring,
and follow [public course distribution](../docs/public-course-distribution.md)
to contribute it to the catalogue.

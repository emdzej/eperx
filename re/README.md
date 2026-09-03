# Reverse-engineering working directory

Scratch space. Nothing here is built or shipped, and most of it is
git-ignored — see the repository's `.gitignore`.

| Path             | Tracked? | What goes in it                                     |
| ---------------- | -------- | --------------------------------------------------- |
| `re/tools/`      | yes      | scripts worth keeping: probes, differential oracles |
| `re/extract/`    | **no**   | anything unpacked from a disc or an installer       |
| `re/decompiled/` | **no**   | `jadx` output from `classes.jar`                    |

**Never commit anything derived from a disc.** Not a fixture, not a sample row,
not a VIN. Tests use synthetic data built in the test file — see
`packages/res/src/zip.test.ts`.

## Getting at the application

ePER is a Java web application. Extracting it needs `unshield`:

```sh
unshield -d re/extract/app x "/Volumes/ePER ed.83/data1.cab"
jadx -d re/decompiled re/extract/app/Application/appsrv/site/WEB-INF/lib/classes.jar
```

That yields 1,094 classes under `it/keytech/`, unobfuscated. The useful
non-code files sit beside it in `WEB-INF/conf/` — `navi.properties` in
particular is the best single orientation document on the disc.

## The differential oracle

`mdbtools` is an independent reading of the same Access files, and that is the
only role it should have here — eperx reads them with `mdb-reader`, and the
point of keeping `mdbtools` around is to have something to disagree with.

```sh
brew install mdbtools
mdb-schema "/Volumes/ePER ed.83/data/SP.DB.04147.FCTLR" sqlite
mdb-export "/Volumes/ePER ed.83/data/SP.DB.04147.FCTLR" MAKES
```

Note that `mdb-schema` prints index definitions **only** with the `sqlite`
backend. Reading its default output and concluding the database has no indexes
is a mistake this project already made once.

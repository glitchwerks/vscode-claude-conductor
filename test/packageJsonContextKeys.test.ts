import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { VIEW_ITEM } from "../src/treeView";

interface Menu {
  command?: string;
  when?: string;
  group?: string;
}

const PKG_PATH = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8")) as {
  contributes?: { menus?: { "view/item/context"?: Menu[] } };
};

const clauses = pkg.contributes?.menus?.["view/item/context"] ?? [];
const allWhen = clauses.map(c => c.when ?? "").filter(Boolean);

const VIEW_ITEM_VALUES = Object.values(VIEW_ITEM) as string[];

/** Extract every `viewItem == "X"` literal token from a when string. */
function extractEqLiterals(when: string): string[] {
  const re = /viewItem\s*==\s*([A-Za-z][A-Za-z0-9._-]*)/g;
  const out: string[] = [];
  let m;
  while ((m = re.exec(when)) !== null) out.push(m[1]);
  return out;
}

/** Extract every `viewItem =~ /pattern/flags?` regex (compiled as RegExp) from a when string. */
function extractRegexes(when: string): RegExp[] {
  // Match: viewItem =~ /escaped/flags?
  const re = /viewItem\s*=~\s*\/((?:\\\/|[^/])+)\/([gimsuy]*)/g;
  const out: RegExp[] = [];
  let m;
  while ((m = re.exec(when)) !== null) {
    // package.json stores `\\.` for a regex literal-dot. After JSON.parse the
    // string already contains a single `\.` — no further unescaping needed.
    out.push(new RegExp(m[1], m[2]));
  }
  return out;
}

const NEGATIVE_FIXTURES = [
  "projectRootSomething",       // missing dot separator
  "projectRoot",                // missing state suffix
  "myprojectRoot.favorited",    // prefix
  "projectRoot.favoritedExtra", // suffix beyond a state token
  "recentProject",              // legacy un-migrated value — should NOT match the migrated regex
  "xyzactiveSession",
  "activeSessionFoo",
];

describe("package.json viewItem ↔ VIEW_ITEM bidirectional bijection", () => {
  it("every `viewItem == X` literal references a VIEW_ITEM value", () => {
    const literals = allWhen.flatMap(extractEqLiterals);
    expect(literals.length).toBeGreaterThan(0);  // sanity: some `==` clauses exist
    for (const lit of literals) {
      expect(VIEW_ITEM_VALUES).toContain(lit);
    }
  });

  it("every `viewItem =~ /pattern/` matches at least one VIEW_ITEM value", () => {
    const regexes = allWhen.flatMap(extractRegexes);
    for (const re of regexes) {
      const matched = VIEW_ITEM_VALUES.some(v => re.test(v));
      expect(matched, `regex ${re.source} matched no VIEW_ITEM value`).toBe(true);
    }
  });

  it("every VIEW_ITEM value is referenced by at least one menu clause", () => {
    const literals = allWhen.flatMap(extractEqLiterals);
    const regexes = allWhen.flatMap(extractRegexes);
    for (const value of VIEW_ITEM_VALUES) {
      const referenced =
        literals.includes(value) ||
        regexes.some(re => re.test(value));
      expect(
        referenced,
        `VIEW_ITEM value '${value}' is orphaned (no menu clause references it)`
      ).toBe(true);
    }
  });

  it("regexes do not match negative-fixture sibling tokens", () => {
    const regexes = allWhen.flatMap(extractRegexes);
    for (const re of regexes) {
      for (const neg of NEGATIVE_FIXTURES) {
        expect(
          re.test(neg),
          `regex ${re.source} unexpectedly matched negative fixture '${neg}'`
        ).toBe(false);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Cluster F (PR #77 CodeRabbit finding 4): openSession must not be offered
  // on missing rows — locateFavorite is the correct action there, since
  // openSession rejects nonexistent directories with an error.
  // -------------------------------------------------------------------------
  it("openSession's view/item/context 'when' clauses exclude projectRoot.missing", () => {
    const openSessionClauses = clauses.filter(
      (c) => c.command === "claudeConductor.openSession" && c.when
    );
    expect(openSessionClauses.length).toBeGreaterThan(0); // sanity: clauses exist

    for (const c of openSessionClauses) {
      const when = c.when ?? "";
      const literals = extractEqLiterals(when);
      const regexes = extractRegexes(when);

      const matchesMissingLiteral = literals.includes("projectRoot.missing");
      const matchesMissingRegex = regexes.some((re) => re.test("projectRoot.missing"));

      expect(
        matchesMissingLiteral || matchesMissingRegex,
        `openSession when-clause '${when}' must exclude projectRoot.missing — missing rows should route to locateFavorite instead, since openSession rejects nonexistent directories`
      ).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Issue #79: PR #77 moved the projectRoot.favorited|unfavorited|missing
  // contextValue to the group row (so the favorites star lives there). That
  // left the Recent Projects group row as the only thing carrying a
  // projectRoot.* contextValue, which the openSession inline-menu clause
  // matches — so the Launch Session play button now shows on the
  // always-visible group row instead of the inner leaf rows.
  //
  // Fix ("Option A" in the issue): a leaf-only contextValue, distinct from
  // the group row's projectRoot.* token, assumed here to be
  // "recentProjectLeaf" (the issue's own suggested example name). The
  // openSession clause scoped to the recentProjects view should match that
  // leaf token instead of the group's projectRoot.(favorited|unfavorited).
  // Worktree-child leaves (viewItem == worktreeChild) and the
  // addFavorite/removeFavorite clauses (group-row-only) are unaffected by
  // this change and are not asserted on here.
  // -------------------------------------------------------------------------
  describe("issue #79 — Launch Session must target the Recent-Projects leaf row, not the group row", () => {
    const RECENT_PROJECT_LEAF = "recentProjectLeaf";

    const openSessionClauses = clauses.filter(
      (c) => c.command === "claudeConductor.openSession" && c.when
    );

    /**
     * Every `when` clause in this project that scopes to the recentProjects
     * view spells the view id out literally (`view == claudeConductor.recentProjects`
     * or a `view =~ /.../ ` regex containing the substring) — see the
     * existing view/item/context clauses in package.json. A substring check
     * is sufficient and avoids re-implementing a `when`-clause parser.
     */
    function targetsRecentProjectsView(when: string): boolean {
      return when.includes("recentProjects");
    }

    const recentProjectsOpenSessionClauses = openSessionClauses.filter((c) =>
      targetsRecentProjectsView(c.when ?? "")
    );

    it("sanity: at least one openSession clause is scoped to the recentProjects view", () => {
      expect(recentProjectsOpenSessionClauses.length).toBeGreaterThan(0);
    });

    it("no openSession clause scoped to the recentProjects view matches the group row's projectRoot.favorited/unfavorited token", () => {
      for (const c of recentProjectsOpenSessionClauses) {
        const when = c.when ?? "";
        const literals = extractEqLiterals(when);
        const regexes = extractRegexes(when);

        for (const groupToken of ["projectRoot.favorited", "projectRoot.unfavorited"]) {
          const matchesLiteral = literals.includes(groupToken);
          const matchesRegex = regexes.some((re) => re.test(groupToken));
          expect(
            matchesLiteral || matchesRegex,
            `openSession when-clause '${when}' (scoped to recentProjects) must NOT match group-row token '${groupToken}' — the Launch Session play button belongs on the leaf row, not the always-visible group row (issue #79). Note: the Favorites view still needs 'projectRoot.favorited' to match openSession (FavoriteLeafItem is a flat row, not a group+leaf pair), so the fix must split the old combined clause by view rather than narrowing viewItem alone across both views.`
          ).toBe(false);
        }
      }
    });

    it("openSession still matches projectRoot.favorited for the favorites view (must survive the recentProjects narrowing)", () => {
      const favoritesScoped = openSessionClauses.filter((c) =>
        (c.when ?? "").includes("favorites")
      );
      expect(favoritesScoped.length).toBeGreaterThan(0); // sanity

      const matchesFavoritedToken = favoritesScoped.some((c) => {
        const when = c.when ?? "";
        const literals = extractEqLiterals(when);
        const regexes = extractRegexes(when);
        return (
          literals.includes("projectRoot.favorited") ||
          regexes.some((re) => re.test("projectRoot.favorited"))
        );
      });

      expect(
        matchesFavoritedToken,
        "Favorites leaf rows carry the projectRoot.favorited contextValue directly (FavoriteLeafItem is a flat row, no separate group/leaf split) and need it to keep matching openSession for their Launch Session button — issue #79's fix must not strip projectRoot.favorited from openSession entirely, only from the recentProjects-scoped clause"
      ).toBe(true);
    });

    it("an openSession clause scoped to the recentProjects view matches the new leaf-only token", () => {
      const matchesLeafToken = recentProjectsOpenSessionClauses.some((c) => {
        const when = c.when ?? "";
        const literals = extractEqLiterals(when);
        const regexes = extractRegexes(when);
        return (
          literals.includes(RECENT_PROJECT_LEAF) ||
          regexes.some((re) => re.test(RECENT_PROJECT_LEAF))
        );
      });

      expect(
        matchesLeafToken,
        `no openSession clause scoped to the recentProjects view matches the assumed leaf-only token '${RECENT_PROJECT_LEAF}' — introduce a distinct contextValue for non-worktree Recent-Projects leaf rows and reference it in the openSession when-clause (issue #79, Option A)`
      ).toBe(true);
    });

    it("VIEW_ITEM exposes the new leaf-only token so the bijection detector above can track it", () => {
      expect(
        VIEW_ITEM_VALUES,
        `VIEW_ITEM should include a '${RECENT_PROJECT_LEAF}' value for the Recent-Projects leaf contextValue (issue #79) so the bijection tests above cover it`
      ).toContain(RECENT_PROJECT_LEAF);
    });
  });

  // -------------------------------------------------------------------------
  // Issue #103 (workspace-folder-launcher-design spec, FR-4): a new
  // "Workspace Folders" tree section needs its own leaf-only contextValue,
  // wired into the openSession inline-launch button the same way
  // recentProjectLeaf/worktreeChild/projectRoot.favorited already are
  // (package.json:162-176 pattern). This extends the existing bijection
  // harness rather than duplicating it, per NFR-12(c) bullet 1.
  // -------------------------------------------------------------------------
  describe("issue #103 — Launch Session inline button for the new Workspace Folders view", () => {
    const WORKSPACE_FOLDER_LEAF = "workspaceFolderLeaf";

    it("VIEW_ITEM exposes the WORKSPACE_FOLDER_LEAF token so the bijection detector above can track it (FR-4)", () => {
      expect(
        VIEW_ITEM_VALUES,
        `VIEW_ITEM should include a '${WORKSPACE_FOLDER_LEAF}' value for the Workspace Folders leaf contextValue (issue #103, FR-4) so the bijection tests above cover it`
      ).toContain(WORKSPACE_FOLDER_LEAF);
    });

    it("an openSession view/item/context clause matches the workspaceFolderLeaf token (FR-4)", () => {
      const openSessionClauses = clauses.filter(
        (c) => c.command === "claudeConductor.openSession" && c.when
      );
      const matchesLeafToken = openSessionClauses.some((c) => {
        const when = c.when ?? "";
        const literals = extractEqLiterals(when);
        const regexes = extractRegexes(when);
        return (
          literals.includes(WORKSPACE_FOLDER_LEAF) ||
          regexes.some((re) => re.test(WORKSPACE_FOLDER_LEAF))
        );
      });

      expect(
        matchesLeafToken,
        `no openSession clause matches the '${WORKSPACE_FOLDER_LEAF}' token — wire it into package.json's view/item/context menu contribution for the inline launch button (FR-4), mirroring the recentProjectLeaf/favorites/worktreeChild clauses at package.json:162-176`
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Issue #103 (FR-6): the new "Workspace Folders" view's visibility when-clause
// lives on contributes.views, not contributes.menus["view/item/context"] — it
// is outside what the bijection harness above parses. Purpose-built coverage,
// per NFR-12(c) bullet 2.
// ---------------------------------------------------------------------------

interface ViewContribution {
  id?: string;
  name?: string;
  when?: string;
}

const pkgViews = JSON.parse(fs.readFileSync(PKG_PATH, "utf8")) as {
  contributes?: { views?: { claudeConductor?: ViewContribution[] } };
};

const claudeConductorViews = pkgViews.contributes?.views?.claudeConductor ?? [];
const workspaceFoldersView = claudeConductorViews.find((v) => v.name === "Workspace Folders");

describe("contributes.views — Workspace Folders visibility when-clause (issue #103, FR-6)", () => {
  it("a 'Workspace Folders' view entry exists in contributes.views.claudeConductor (FR-1)", () => {
    expect(
      workspaceFoldersView,
      "package.json's contributes.views.claudeConductor must include a 'Workspace Folders' entry, a 4th tree section alongside Active Sessions / Favorites / Recent Projects (FR-1)"
    ).toBeDefined();
  });

  it("the 'Workspace Folders' view is gated by the claudeConductor.hasMultiRootWorkspace when-clause (FR-6)", () => {
    expect(
      workspaceFoldersView?.when,
      "the new view must carry a 'when' clause referencing claudeConductor.hasMultiRootWorkspace so the section is hidden entirely at 0 or 1 workspace roots (FR-6)"
    ).toContain("claudeConductor.hasMultiRootWorkspace");
  });
});

// ---------------------------------------------------------------------------
// Issue #103 (FR-7, NFR-8): the new claudeConductor.launchInWorkspaceFolder
// command must be contributed to the command palette — registered
// unconditionally (no `when` gate on the command's own registration; NFR-8),
// unlike claudeConductor.openHere/openHereFromFile which are explicitly
// palette-hidden via a `commandPalette` `when: "false"` clause.
// ---------------------------------------------------------------------------

interface CommandContribution {
  command?: string;
  title?: string;
}

const pkgCommands = JSON.parse(fs.readFileSync(PKG_PATH, "utf8")) as {
  contributes?: {
    commands?: CommandContribution[];
    menus?: { commandPalette?: Menu[] };
  };
};

const contributedCommands = pkgCommands.contributes?.commands ?? [];
const launchInWorkspaceFolderCommand = contributedCommands.find(
  (c) => c.command === "claudeConductor.launchInWorkspaceFolder"
);

describe("contributes.commands — claudeConductor.launchInWorkspaceFolder (issue #103, FR-7)", () => {
  it("is contributed with the exact command id and title from FR-7", () => {
    expect(
      launchInWorkspaceFolderCommand,
      "package.json's contributes.commands must include claudeConductor.launchInWorkspaceFolder so it is visible in the command palette (FR-7)"
    ).toBeDefined();
    expect(launchInWorkspaceFolderCommand?.title).toBe(
      "Claude Conductor: Launch Session in Workspace Folder..."
    );
  });

  it("is not hidden from the command palette (NFR-8: registered unconditionally, no when-gate)", () => {
    const paletteClauses = pkgCommands.contributes?.menus?.commandPalette ?? [];
    const hiddenClause = paletteClauses.find(
      (c) => c.command === "claudeConductor.launchInWorkspaceFolder" && c.when === "false"
    );
    expect(
      hiddenClause,
      "claudeConductor.launchInWorkspaceFolder must not carry a commandPalette when:'false' clause (unlike openHere/openHereFromFile) — NFR-8 requires it stay visible in the command palette"
    ).toBeUndefined();
  });
});

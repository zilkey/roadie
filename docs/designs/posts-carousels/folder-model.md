# Folder model (decided Nov 12)

This replaces the Ideas / Drafts / Posted layout in `design.md`. It comes from the EGM review decisions b4, m02, m08, m09 and m22 (see the decision log on zilkey/roadie-issues#75).

```
Socials/                                   the folder set in Settings › Google; anyone in the band adds here
├── Jeff's phone spring 26/                subfolders are fine; Roadie walks every folder except Posts/
│   └── IMG_2201.HEIC
├── IMG_4413.HEIC                          a photo loose anywhere in the inbox has not been used
└── Posts/                                 Roadie keeps this folder: one folder per post
    ├── 2026-11-12 - Hi-Dive announcement/ a draft (status lives in Firestore)
    │   ├── IMG_4410.HEIC
    │   └── IMG_4412.HEIC
    └── 2026-11-03 - Thanks, Denver/       posted
        ├── IMG_4300.HEIC
        └── IMG_4301.HEIC
```

## Rules

- **The inbox** is the Socials folder and every folder under it except `Posts/`. Photos can be loose or in any subfolder, so a whole phone dump works as it is.
- **Make the draft** creates `Posts/YYYY-MM-DD - <name>` and moves the chosen photos into it. The date is the day the draft was made, in the band's timezone. Each photo's original folder is recorded on the post so it can go back there.
- **When the post goes out**, Roadie renames the folder to the day it posted (`YYYY-MM-DD - <name>`, band timezone). Files keep their original names; the carousel order lives only in Roadie. If the post fails, nothing in Drive changes.
- **Taking a photo out of a draft** moves it back to the folder it came from. If that folder is gone, it goes to the Socials root.
- **Delete draft** moves every photo back, then trashes the post folder only if it is empty. If it isn't (someone added a file in Drive), Roadie leaves the folder and says so.
- **Status** (`draft`, `publishing`, `posted`, `failed`) lives only on the `posts` doc in Firestore. Roadie writes no tags or appProperties into Drive. The `posts` doc is the source of truth, and the folders mirror it.
- **Badges** in Photos ("In a draft", "Posted Nov 14") come from the `posts` docs. A photo already in a post folder can be added to another post only by picking it from `Posts/` (rule to settle in the spec rewrite).
- **Shared Drive:** Socials lives in a Shared Drive, so Drive won't refuse a move because a different member owns the file. There is no shortcut fallback.
- **Roadie never deletes a photo.** It moves photos, renames post folders, and trashes only empty post folders it made.
- **Tidy failure:** the only Drive step after posting is the folder rename. If it fails, the post stays `posted`, and the post page offers a retry (m05).

## Photos grid

- It is grouped by the day each photo was taken, in the band's timezone, and each day is labelled with that day's show or rehearsal ("Sat Nov 14 · Hi-Dive show"). Roadie looks up past shows and rehearsals by date, because the calendar data the client already loads drops anything before today.
- The folder rail has Socials (all), each inbox subfolder, and Posts.

## What this removes from the spec
- The Ideas, Drafts and Posted folders, and `Posted/YYYY-MM` month folders.
- `artists.postsFolders` (only `postsFolderId` remains, and Roadie finds or makes `Posts/` inside it).
- appProperties, `setAppProperties` and Drive shortcuts.
- Numbering files at publish.
- Most of the folder setup step: setup now makes `Posts/` and shares the Socials folder with the band as writer.

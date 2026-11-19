#!/usr/bin/env python3
"""Добавляет Swift-файлы нативного слоя в Xcode-проект и убирает старую раскладку."""
import re
import pathlib

PBX = pathlib.Path(__file__).resolve().parents[1] / "App" / "App.xcodeproj" / "project.pbxproj"

SWIFT_FILES = [
    "Models.swift",
    "Engine.swift",
    "Theme.swift",
    "Kit.swift",
    "AveonRootView.swift",
    "AveonViewController.swift",
    "PlayerView.swift",
    "HomeView.swift",
    "WaveView.swift",
    "LibraryView.swift",
    "ProfileView.swift",
    "FriendsView.swift",
    "AuthView.swift",
    "MirrorView.swift",
    "Sheets.swift",
    "EqView.swift",
    "LocalServer.swift",
    "MediaStore.swift",
    "Vault.swift",
    "NowPlaying.swift",
    "CallMonitor.swift",
    "AveonPlugin.swift",
]

text = PBX.read_text(encoding="utf-8")

# --- убираем Main.storyboard (интерфейс теперь нативный, сцена — в коде) ---
text = re.sub(r"^\t\t504EC30D1FED79650016851F /\* Main\.storyboard in Resources \*/ = \{isa = PBXBuildFile; fileRef = 504EC30B1FED79650016851F /\* Main\.storyboard \*/; \};\n", "", text, flags=re.M)
text = re.sub(r"^\t\t504EC30C1FED79650016851F /\* Base \*/ = \{isa = PBXFileReference; lastKnownFileType = file\.storyboard; name = Base; path = Base\.lproj/Main\.storyboard; sourceTree = \"<group>\"; \};\n", "", text, flags=re.M)
text = re.sub(r"\t\t504EC30B1FED79650016851F /\* Main\.storyboard \*/ = \{\n\t\t\tisa = PBXVariantGroup;\n\t\t\tchildren = \(\n\t\t\t\t504EC30C1FED79650016851F /\* Base \*/,\n\t\t\t\);\n\t\t\tname = Main\.storyboard;\n\t\t\tsourceTree = \"<group>\";\n\t\t\};\n", "", text)
text = text.replace("\t\t\t\t504EC30B1FED79650016851F /* Main.storyboard */,\n", "")

# --- новые файлы ---
counter = 0x100
def next_id():
    global counter
    counter += 1
    return "AB01%020X" % counter

file_refs = []
build_files = []
for name in SWIFT_FILES:
    if ("path = %s; sourceTree" % name) in text:
        continue  # уже в проекте
    ref = next_id()
    bld = next_id()
    file_refs.append((ref, name))
    build_files.append((bld, ref, name))

new_file_refs = "".join(
    "\t\t%s /* %s */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = %s; sourceTree = \"<group>\"; };\n" % (ref, name, name)
    for ref, name in file_refs
)
new_build_files = "".join(
    "\t\t%s /* %s in Sources */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };\n" % (bld, name, ref, name)
    for bld, ref, name in build_files
)

text = text.replace("/* End PBXBuildFile section */", new_build_files + "/* End PBXBuildFile section */")
text = text.replace("/* End PBXFileReference section */", new_file_refs + "/* End PBXFileReference section */")

# --- группа App ---
group_children = "".join("\t\t\t\t%s /* %s */,\n" % (ref, name) for ref, name in file_refs)
text = text.replace(
    "\t\t\t\t504EC3071FED79650016851F /* AppDelegate.swift */,\n",
    "\t\t\t\t504EC3071FED79650016851F /* AppDelegate.swift */,\n" + group_children,
)

# --- Sources ---
sources = "".join("\t\t\t\t%s /* %s in Sources */,\n" % (bld, name) for bld, ref, name in build_files)
text = text.replace(
    "\t\t\t\t9582B6832FE993A70072D4E8 /* SceneDelegate.swift in Sources */,\n",
    "\t\t\t\t9582B6832FE993A70072D4E8 /* SceneDelegate.swift in Sources */,\n" + sources,
)

# --- iOS 16: NavigationStack, presentationDetents, AVURLAsset.load ---
text = text.replace("IPHONEOS_DEPLOYMENT_TARGET = 15.0;", "IPHONEOS_DEPLOYMENT_TARGET = 16.0;")

PBX.write_text(text, encoding="utf-8")
print("обновлено:", PBX)

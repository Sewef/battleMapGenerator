#!/usr/bin/env python3
"""Synchronise les variantes, puis renumérote les rochers sans trous.

Exemples :
    python renumber_assets.py          # affiche les changements prévus
    python renumber_assets.py --apply  # applique les renommages

Les fichiers ``rock_<numéro>_<taille>.png`` sont la source de vérité. Une
variante dark/desert/light/snow sans fichier de base correspondant est supprimée.
Les identifiants sont ensuite rendus continus séparément pour chaque taille,
tout en restant identiques entre les variantes d'une même image.
Seuls les PNG placés à côté de ce script sont traités ; le dossier ``misc``
est volontairement ignoré.
"""

from __future__ import annotations

import argparse
import re
import sys
import uuid
from pathlib import Path


ASSET_PATTERN = re.compile(
    r"^(?P<prefix>rock(?:_(?:dark|desert|light|snow))?)_"
    r"(?P<number>\d+)_"
    r"(?P<size>\d+x\d+)\.png$",
    re.IGNORECASE,
)


def build_plan(
    directory: Path,
) -> tuple[list[Path], list[tuple[Path, Path]]]:
    """Construit les suppressions de variantes et le plan old -> new."""
    assets: list[tuple[Path, re.Match[str]]] = []

    for path in directory.iterdir():
        if not path.is_file():
            continue
        match = ASSET_PATTERN.fullmatch(path.name)
        if match:
            assets.append((path, match))

    base_keys = {
        (int(match["number"]), match["size"].lower())
        for _, match in assets
        if match["prefix"].lower() == "rock"
    }

    deletions = sorted(
        (
            path
            for path, match in assets
            if match["prefix"].lower() != "rock"
            and (int(match["number"]), match["size"].lower()) not in base_keys
        ),
        key=lambda path: path.name.lower(),
    )
    deletion_set = set(deletions)

    sizes = sorted({size for _, size in base_keys})
    number_mapping: dict[tuple[str, int], int] = {}
    for size in sizes:
        old_numbers = sorted(number for number, key_size in base_keys if key_size == size)
        number_mapping.update({
            (size, old_number): new_number
            for new_number, old_number in enumerate(old_numbers, start=1)
        })

    plan: list[tuple[Path, Path]] = []
    for source, match in assets:
        if source in deletion_set:
            continue
        new_number = number_mapping[(match["size"].lower(), int(match["number"]))]
        target = source.with_name(
            f"{match['prefix']}_{new_number}_{match['size']}.png"
        )
        if source != target:
            plan.append((source, target))

    return deletions, sorted(plan, key=lambda item: item[0].name.lower())


def validate_plan(deletions: list[Path], plan: list[tuple[Path, Path]]) -> None:
    """Refuse tout plan ambigu ou susceptible d'écraser un autre fichier."""
    sources = {source for source, _ in plan}
    deletion_set = set(deletions)
    targets: set[Path] = set()

    for _, target in plan:
        if target in targets:
            raise RuntimeError(f"Plusieurs fichiers auraient la même cible : {target.name}")
        targets.add(target)

        if target.exists() and target not in sources and target not in deletion_set:
            raise RuntimeError(f"La cible existe déjà et ne sera pas écrasée : {target.name}")


def temporary_path(path: Path, operation: str) -> Path:
    return path.with_name(f".{path.name}.{uuid.uuid4().hex}.{operation}")


def apply_plan(deletions: list[Path], plan: list[tuple[Path, Path]]) -> None:
    """Applique suppressions et renommages sans collision intermédiaire."""
    staged_deletions: list[tuple[Path, Path]] = []
    staged_renames: list[tuple[Path, Path, Path]] = []
    completed_renames: list[tuple[Path, Path]] = []

    try:
        # Les suppressions sont d'abord mises de côté pour pouvoir les restaurer
        # si un renommage échoue avant la fin de l'opération.
        for original in deletions:
            temporary = temporary_path(original, "deleting")
            original.rename(temporary)
            staged_deletions.append((temporary, original))

        for source, target in plan:
            temporary = temporary_path(source, "renaming")
            source.rename(temporary)
            staged_renames.append((temporary, source, target))

        for temporary, source, target in staged_renames:
            temporary.rename(target)
            completed_renames.append((target, source))
    except Exception:
        # Remet d'abord les renommages terminés dans des fichiers temporaires,
        # afin de libérer tous les noms d'origine avant la restauration.
        rollback_files: list[tuple[Path, Path]] = []
        for target, source in reversed(completed_renames):
            if target.exists():
                rollback = temporary_path(target, "rollback")
                target.rename(rollback)
                rollback_files.append((rollback, source))

        for temporary, source, _ in staged_renames:
            if temporary.exists():
                rollback_files.append((temporary, source))

        for temporary, source in rollback_files:
            temporary.rename(source)

        for temporary, original in staged_deletions:
            if temporary.exists():
                temporary.rename(original)
        raise

    for temporary, _ in staged_deletions:
        temporary.unlink()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="applique les renommages (sans cette option, affiche seulement l'aperçu)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    directory = Path(__file__).resolve().parent
    deletions, plan = build_plan(directory)

    try:
        validate_plan(deletions, plan)
    except RuntimeError as error:
        print(f"Erreur : {error}", file=sys.stderr)
        return 1

    if not deletions and not plan:
        print("Aucun changement nécessaire : variantes synchronisées et numérotation continue.")
        return 0

    for path in deletions:
        print(f"SUPPRIMER  {path.name}")

    for source, target in plan:
        print(f"RENOMMER   {source.name} -> {target.name}")

    if not args.apply:
        print(
            f"\nAperçu : {len(deletions)} fichier(s) à supprimer, "
            f"{len(plan)} fichier(s) à renommer."
        )
        print("Relance avec --apply pour appliquer ces changements.")
        return 0

    apply_plan(deletions, plan)
    print(
        f"\nTerminé : {len(deletions)} fichier(s) supprimé(s), "
        f"{len(plan)} fichier(s) renommé(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

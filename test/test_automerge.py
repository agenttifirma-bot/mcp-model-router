import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from unittest import mock

_POLKU = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools", "automerge.py")
_spec = importlib.util.spec_from_file_location("automerge_under_test", _POLKU)
am = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(am)


def tiedosto(nimi, changes=1, status="modified", **muut):
    d = {"filename": nimi, "changes": changes, "status": status}
    d.update(muut)
    return d


def oma_pr(**yli):
    pr = {
        "draft": False,
        "head_repo": "o/r",
        "base_repo": "o/r",
        "labels": [],
        "author": "ihminen",
        "head_ref": "feature/x",
        "base_ref": "main",
    }
    pr.update(yli)
    return pr


def botin_pr(haara="yo/testit-2026-10-28", **yli):
    pr = {
        "draft": False,
        "head_repo": "agenttifirma-bot/r",
        "base_repo": "o/r",
        "labels": [],
        "author": "agenttifirma-bot",
        "head_ref": haara,
        "base_ref": "main",
    }
    pr.update(yli)
    return pr


class PolkuOkTest(unittest.TestCase):
    def test_sallitut_polut(self):
        for p in ("README.md", "docs/opas.md", "docs/a/b/c.md", "test/test_x.py", "test/sub/test_y.py"):
            with self.subTest(p=p):
                self.assertEqual(am.polku_ok(p), (True, ""))

    def test_tyhja_polku(self):
        self.assertEqual(am.polku_ok(""), (False, "tyhja polku"))
        self.assertEqual(am.polku_ok(None), (False, "tyhja polku"))

    def test_ei_sallittu_tyyppi(self):
        for p in ("src/a.ts", "test/a.ts", "script.py", "docs/a.txt", "a/b.md"):
            with self.subTest(p=p):
                ok, syy = am.polku_ok(p)
                self.assertFalse(ok)
                self.assertEqual(syy, "ei sallittu tyyppi: " + p)

    def test_suojattu_voittaa_sallitun(self):
        for p in (
            ".github/README.md",
            "tools/test.py",
            "isanta/x.md",
            "systemd/a.md",
            "a/systemd/a.md",
            "yojono/x.md",
            "docs/token.md",
            "docs/Secret.md",
            "test/test_key.py",
            "docs/../x.md",
            "docs/.env.md",
            "package.json",
            "sub/package-lock.json",
            "requirements.txt",
            "dist/a.md",
            "agentti/config.py",
            "agentti/portti.md",
        ):
            with self.subTest(p=p):
                ok, syy = am.polku_ok(p)
                self.assertFalse(ok)
                self.assertEqual(syy, "suojattu polku: " + p)


class BotinKoodiOkTest(unittest.TestCase):
    def test_sallitut(self):
        for p in ("src/a.ts", "src/lib/x.py", "test/a.test.ts", "scripts/a.mjs", "a.js", "x.tsx", "y.jsx", "README.md"):
            with self.subTest(p=p):
                self.assertEqual(am.botin_koodi_ok(p), (True, ""))

    def test_vaarat_merkit(self):
        ok, syy = am.botin_koodi_ok("src/a b.ts")
        self.assertFalse(ok)
        self.assertEqual(syy, "ei sallittu polku: src/a b.ts")
        self.assertEqual(am.botin_koodi_ok(None), (False, "ei sallittu polku: None"))
        self.assertEqual(am.botin_koodi_ok("")[0], False)

    def test_suojatut(self):
        for p in (".github/a.py", "tools/a.py", "yojono/a.ts", "package.json", "src/keyboard.ts", "systemd/a.md"):
            with self.subTest(p=p):
                self.assertEqual(am.botin_koodi_ok(p), (False, "suojattu polku: " + p))

    def test_vaara_paate(self):
        self.assertEqual(am.botin_koodi_ok("config.yaml"), (False, "ei sallittu paate: config.yaml"))
        self.assertEqual(am.botin_koodi_ok("src/a.json")[0], False)
        self.assertEqual(am.botin_koodi_ok("src/a.sh")[0], False)


class BotinForkkiSyytTest(unittest.TestCase):
    def test_kelvollinen(self):
        for haara in ("yo/readme-x", "yo/testit-2026-10-28", "yo/ominaisuus-a.b_c-1"):
            with self.subTest(haara=haara):
                self.assertEqual(am.botin_forkki_syyt(botin_pr(haara)), [])

    def test_kirjainkoko_ei_merkitse_tekijassa_ja_repossa(self):
        pr = botin_pr(author="AgenttiFirma-Bot", head_repo="AGENTTIFIRMA-BOT/R")
        self.assertEqual(am.botin_forkki_syyt(pr), [])

    def test_vieras_tekija(self):
        syyt = am.botin_forkki_syyt(botin_pr(author="joku-muu"))
        self.assertEqual(syyt, ["PR ei ole saman repon haarasta"])

    def test_vaara_forkki(self):
        syyt = am.botin_forkki_syyt(botin_pr(head_repo="agenttifirma-bot/toinen"))
        self.assertEqual(syyt, ["forkki ei ole botin oma fork samasta reposta"])

    def test_base_repo_puuttuu(self):
        syyt = am.botin_forkki_syyt(botin_pr(base_repo=None))
        self.assertIn("forkki ei ole botin oma fork samasta reposta", syyt)

    def test_base_ei_main(self):
        self.assertEqual(am.botin_forkki_syyt(botin_pr(base_ref="develop")), ["base ei ole main eika master"])
        self.assertEqual(am.botin_forkki_syyt(botin_pr(base_ref="master")), [])

    def test_haaran_nimi(self):
        for haara in ("main", "yo/muu-x", "yo/testit-", "yo/testit-Isot", "yo/testit-a b", None, "yo/testit-" + "a" * 61):
            with self.subTest(haara=haara):
                syyt = am.botin_forkki_syyt(botin_pr(haara))
                self.assertEqual(syyt, ["botin haaran nimi ei ole yo/(readme|testit|ominaisuus)-*"])

    def test_haaran_nimi_enimmaispituus(self):
        self.assertEqual(am.botin_forkki_syyt(botin_pr("yo/testit-" + "a" * 60)), [])


class ArvioiSamaRepoTest(unittest.TestCase):
    def test_dokumentti_ja_testi_kelpaavat(self):
        ok, syyt = am.arvioi(oma_pr(), [tiedosto("README.md"), tiedosto("test/test_a.py", status="added")])
        self.assertTrue(ok)
        self.assertEqual(syyt, [])

    def test_luonnos(self):
        ok, syyt = am.arvioi(oma_pr(draft=True), [tiedosto("README.md")])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["luonnos"])

    def test_opt_out_tunniste(self):
        ok, syyt = am.arvioi(oma_pr(labels=["ei-automerge"]), [tiedosto("README.md")])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["tunniste ei-automerge"])

    def test_labels_none(self):
        ok, _ = am.arvioi(oma_pr(labels=None), [tiedosto("README.md")])
        self.assertTrue(ok)

    def test_ei_tiedostoja(self):
        ok, syyt = am.arvioi(oma_pr(), [])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["ei tiedostoja"])

    def test_tiedostoraja(self):
        tiedostot = [tiedosto("docs/a%d.md" % i) for i in range(am.MAX_TIEDOSTOA)]
        self.assertTrue(am.arvioi(oma_pr(), tiedostot)[0])
        tiedostot.append(tiedosto("docs/extra.md"))
        ok, syyt = am.arvioi(oma_pr(), tiedostot)
        self.assertFalse(ok)
        self.assertEqual(syyt, ["liian monta tiedostoa (21)"])

    def test_rivi_raja(self):
        self.assertTrue(am.arvioi(oma_pr(), [tiedosto("README.md", changes=200)])[0])
        ok, syyt = am.arvioi(oma_pr(), [tiedosto("README.md", changes=120), tiedosto("docs/a.md", changes=81)])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["liian suuri muutos (201 rivia)"])

    def test_changes_puuttuu_tulkitaan_nollaksi(self):
        ok, _ = am.arvioi(oma_pr(), [{"filename": "README.md", "status": "added"}])
        self.assertTrue(ok)

    def test_poisto_ja_uudelleennimeaminen_hylataan(self):
        for tila in ("removed", "renamed", "copied", None):
            with self.subTest(tila=tila):
                ok, syyt = am.arvioi(oma_pr(), [tiedosto("README.md", status=tila)])
                self.assertFalse(ok)
                self.assertEqual(syyt, ["tiedoston tila %s: README.md" % tila])

    def test_suojattu_tiedosto(self):
        ok, syyt = am.arvioi(oma_pr(), [tiedosto(".github/workflows/ci.md")])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["suojattu polku: .github/workflows/ci.md"])

    def test_koodi_ei_kelpaa_samassa_repossa(self):
        ok, syyt = am.arvioi(oma_pr(), [tiedosto("src/a.ts")])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["ei sallittu tyyppi: src/a.ts"])

    def test_previous_filename_tarkistetaan(self):
        ok, syyt = am.arvioi(oma_pr(), [tiedosto("README.md", status="added", previous_filename="tools/automerge.py")])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["suojattu polku: tools/automerge.py"])

    def test_sama_syy_ei_toistu(self):
        ok, syyt = am.arvioi(oma_pr(), [tiedosto("src/a.ts"), tiedosto("src/a.ts")])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["ei sallittu tyyppi: src/a.ts"])

    def test_useita_syita_kerataan(self):
        ok, syyt = am.arvioi(oma_pr(draft=True, labels=["ei-automerge"]), [tiedosto("src/a.ts", status="removed")])
        self.assertFalse(ok)
        self.assertEqual(len(syyt), 4)


class ArvioiBotinForkkiTest(unittest.TestCase):
    def test_testit_koodi_kelpaa(self):
        ok, syyt = am.arvioi(botin_pr(), [tiedosto("test/budget.test.ts", status="added", changes=300)])
        self.assertTrue(ok, syyt)

    def test_koodiraja_400(self):
        self.assertTrue(am.arvioi(botin_pr(), [tiedosto("test/a.test.ts", changes=400)])[0])
        ok, syyt = am.arvioi(botin_pr(), [tiedosto("test/a.test.ts", changes=401)])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["liian suuri muutos (401 rivia)"])

    def test_readme_raja_200(self):
        pr = botin_pr("yo/readme-x")
        self.assertTrue(am.arvioi(pr, [tiedosto("README.md", changes=200)])[0])
        ok, syyt = am.arvioi(pr, [tiedosto("README.md", changes=201)])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["liian suuri muutos (201 rivia)"])

    def test_readme_haara_vain_md(self):
        ok, syyt = am.arvioi(botin_pr("yo/readme-x"), [tiedosto("src/a.ts")])
        self.assertFalse(ok)
        self.assertIn("readme-haarasta vain .md-tiedostot: src/a.ts", syyt)

    def test_readme_haara_md_kelpaa(self):
        ok, syyt = am.arvioi(botin_pr("yo/readme-x"), [tiedosto("README.md"), tiedosto("docs/a.md")])
        self.assertTrue(ok, syyt)

    def test_ominaisuus_haara_koodi_kelpaa(self):
        ok, syyt = am.arvioi(botin_pr("yo/ominaisuus-uusi"), [tiedosto("src/uusi.ts", status="added")])
        self.assertTrue(ok, syyt)

    def test_suojattu_polku_hylataan(self):
        for p in (".github/workflows/x.py", "package.json", "yojono/a.py", "systemd/a.md", "src/keys.ts"):
            with self.subTest(p=p):
                ok, syyt = am.arvioi(botin_pr(), [tiedosto(p)])
                self.assertFalse(ok)
                self.assertIn("suojattu polku: " + p, syyt)

    def test_vaara_paate_hylataan(self):
        ok, syyt = am.arvioi(botin_pr(), [tiedosto("config.yaml")])
        self.assertFalse(ok)
        self.assertIn("ei sallittu paate: config.yaml", syyt)

    def test_previous_filename_suojattu(self):
        ok, syyt = am.arvioi(
            botin_pr(), [tiedosto("src/a.ts", status="added", previous_filename="tools/automerge.py")]
        )
        self.assertFalse(ok)
        self.assertIn("suojattu polku: tools/automerge.py", syyt)

    def test_uudelleennimeaminen_hylataan(self):
        ok, syyt = am.arvioi(botin_pr(), [tiedosto("src/b.ts", status="renamed", previous_filename="src/a.ts")])
        self.assertFalse(ok)
        self.assertIn("tiedoston tila renamed: src/b.ts", syyt)

    def test_vieras_forkki_hylataan(self):
        pr = botin_pr(author="joku-muu", head_repo="joku-muu/r")
        ok, syyt = am.arvioi(pr, [tiedosto("README.md")])
        self.assertFalse(ok)
        self.assertIn("PR ei ole saman repon haarasta", syyt)

    def test_botin_forkki_vaaraan_haaraan_hylataan(self):
        ok, syyt = am.arvioi(botin_pr("feature/x"), [tiedosto("README.md")])
        self.assertFalse(ok)
        self.assertIn("botin haaran nimi ei ole yo/(readme|testit|ominaisuus)-*", syyt)

    def test_luonnos_botin_forkista(self):
        ok, syyt = am.arvioi(botin_pr(draft=True), [tiedosto("test/a.test.ts")])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["luonnos"])

    def test_opt_out_botin_forkista(self):
        ok, syyt = am.arvioi(botin_pr(labels=["ei-automerge"]), [tiedosto("test/a.test.ts")])
        self.assertFalse(ok)
        self.assertEqual(syyt, ["tunniste ei-automerge"])


def valmis(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(args=["gh"], returncode=returncode, stdout=stdout, stderr=stderr)


class HaeTest(unittest.TestCase):
    def test_hae_pr_jasentaa_kentat(self):
        data = {
            "draft": True,
            "head": {"repo": {"full_name": "bot/r"}, "ref": "yo/testit-x"},
            "base": {"repo": {"full_name": "o/r"}, "ref": "main"},
            "labels": [{"name": "a"}, {"name": "b"}],
            "user": {"login": "agenttifirma-bot"},
        }
        with mock.patch.object(am, "_gh", return_value=valmis(stdout=json.dumps(data))) as gh:
            pr = am.hae_pr("o/r", "5")
        gh.assert_called_once_with("api", "repos/o/r/pulls/5")
        self.assertEqual(
            pr,
            {
                "draft": True,
                "head_repo": "bot/r",
                "base_repo": "o/r",
                "labels": ["a", "b"],
                "author": "agenttifirma-bot",
                "head_ref": "yo/testit-x",
                "base_ref": "main",
            },
        )

    def test_hae_pr_puuttuvat_kentat(self):
        with mock.patch.object(am, "_gh", return_value=valmis(stdout=json.dumps({"head": {"repo": None}}))):
            pr = am.hae_pr("o/r", "5")
        self.assertFalse(pr["draft"])
        self.assertIsNone(pr["head_repo"])
        self.assertIsNone(pr["base_repo"])
        self.assertEqual(pr["labels"], [])
        self.assertIsNone(pr["author"])

    def test_hae_pr_virhe(self):
        with mock.patch.object(am, "_gh", return_value=valmis(1, stderr="x" * 500 + "loppu")):
            with self.assertRaises(RuntimeError) as cm:
                am.hae_pr("o/r", "5")
        self.assertTrue(str(cm.exception).startswith("PR:n haku epaonnistui: "))
        self.assertTrue(str(cm.exception).endswith("loppu"))
        self.assertLessEqual(len(str(cm.exception)), len("PR:n haku epaonnistui: ") + 200)

    def test_hae_tiedostot_ohittaa_tyhjat_rivit(self):
        ulos = json.dumps({"filename": "a.md"}) + "\n\n  \n" + json.dumps({"filename": "b.md"}) + "\n"
        with mock.patch.object(am, "_gh", return_value=valmis(stdout=ulos)) as gh:
            tiedostot = am.hae_tiedostot("o/r", "7")
        self.assertEqual([t["filename"] for t in tiedostot], ["a.md", "b.md"])
        self.assertIn("repos/o/r/pulls/7/files?per_page=100", gh.call_args.args)

    def test_hae_tiedostot_virhe(self):
        with mock.patch.object(am, "_gh", return_value=valmis(1, stderr="rikki")):
            with self.assertRaises(RuntimeError) as cm:
                am.hae_tiedostot("o/r", "7")
        self.assertIn("tiedostojen haku epaonnistui", str(cm.exception))

    def test_gh_kutsuu_subprocessia(self):
        with mock.patch.object(am.subprocess, "run", return_value=valmis()) as run:
            am._gh("api", "x")
        run.assert_called_once_with(["gh", "api", "x"], capture_output=True, text=True, timeout=120)


class YhteenvetoTest(unittest.TestCase):
    def test_kirjoittaa_step_summaryyn(self):
        with tempfile.TemporaryDirectory() as d:
            tiedosto_ = os.path.join(d, "summary.md")
            with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": tiedosto_}):
                with mock.patch("builtins.print") as pr:
                    am.yhteenveto("hei")
                    am.yhteenveto("moi")
            pr.assert_any_call("hei")
            with open(tiedosto_) as f:
                self.assertEqual(f.read(), "hei\nmoi\n")

    def test_ilman_ymparistomuuttujaa_vain_tulostus(self):
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_STEP_SUMMARY"}
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch("builtins.print") as pr:
                am.yhteenveto("hei")
        pr.assert_called_once_with("hei")

    def test_kirjoitusvirhe_niellaan(self):
        with tempfile.TemporaryDirectory() as d:
            # hakemisto ei ole kirjoitettava tiedosto -> OSError
            with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": d}):
                with mock.patch("builtins.print"):
                    am.yhteenveto("hei")


class MainTest(unittest.TestCase):
    def aja(self, env, pr=None, tiedostot=None, gh=None, hae_pr_virhe=None):
        patches = [
            mock.patch.dict(os.environ, env, clear=False),
            mock.patch.object(am, "yhteenveto"),
            mock.patch.object(am, "_gh", side_effect=gh or (lambda *a: valmis())),
        ]
        if hae_pr_virhe:
            patches.append(mock.patch.object(am, "hae_pr", side_effect=hae_pr_virhe))
        else:
            patches.append(mock.patch.object(am, "hae_pr", return_value=pr))
        patches.append(mock.patch.object(am, "hae_tiedostot", return_value=tiedostot or []))
        mocks = [p.start() for p in patches]
        try:
            koodi = am.main()
        finally:
            mock.patch.stopall()
        return koodi, mocks[1], mocks[2]

    def test_virheellinen_repo(self):
        for repo in ("", "ei-vinoviivaa", "a/b/c", "a b/c", "a/;rm"):
            with self.subTest(repo=repo):
                with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": repo, "PR_NUMBER": "1"}):
                    with mock.patch("builtins.print"):
                        self.assertEqual(am.main(), 2)

    def test_virheellinen_pr_numero(self):
        for nro in ("", "abc", "1; ls", "-1", "1.5"):
            with self.subTest(nro=nro):
                with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "PR_NUMBER": nro}):
                    with mock.patch("builtins.print"):
                        self.assertEqual(am.main(), 2)

    def test_arviointi_epaonnistuu(self):
        koodi, yhteenveto, gh = self.aja(
            {"GITHUB_REPOSITORY": "o/r", "PR_NUMBER": "3"}, hae_pr_virhe=RuntimeError("rikki")
        )
        self.assertEqual(koodi, 1)
        gh.assert_not_called()
        self.assertIn("rikki", yhteenveto.call_args.args[0])

    def test_kelpaava_pr_kytkee_automergen(self):
        koodi, yhteenveto, gh = self.aja(
            {"GITHUB_REPOSITORY": "o/r", "PR_NUMBER": "3"}, pr=oma_pr(), tiedostot=[tiedosto("README.md")]
        )
        self.assertEqual(koodi, 0)
        gh.assert_called_once_with("pr", "merge", "3", "--auto", "--squash", "--repo", "o/r")
        self.assertIn("kelpaa", yhteenveto.call_args.args[0])

    def test_kytkenta_epaonnistuu(self):
        koodi, yhteenveto, _ = self.aja(
            {"GITHUB_REPOSITORY": "o/r", "PR_NUMBER": "3"},
            pr=oma_pr(),
            tiedostot=[tiedosto("README.md")],
            gh=lambda *a: valmis(1, stderr="ei onnistu"),
        )
        self.assertEqual(koodi, 1)
        self.assertIn("kytkenta epaonnistui: ei onnistu", yhteenveto.call_args.args[0])

    def test_kelpaamaton_pr_poistaa_automergen(self):
        koodi, yhteenveto, gh = self.aja(
            {"GITHUB_REPOSITORY": "o/r", "PR_NUMBER": "3"}, pr=oma_pr(draft=True), tiedostot=[tiedosto("README.md")]
        )
        self.assertEqual(koodi, 0)
        gh.assert_called_once_with("pr", "merge", "3", "--disable-auto", "--repo", "o/r")
        self.assertIn("luonnos", yhteenveto.call_args.args[0])
        self.assertIn("Auto-merge poistettu", yhteenveto.call_args.args[0])


if __name__ == "__main__":
    unittest.main()

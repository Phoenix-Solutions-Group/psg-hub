"""Offline unit tests for the Ads Mutation Studio sandbox runner (runner.py).

These prove the PER-MUTATION ADAPTER layer + the dry-run-never-mutates invariant WITHOUT
the Google SDKs: the real `googleads_psg.*` / `gtm_psg.*` modules are replaced in
sys.modules with lightweight fakes that record calls. Run with:

    python -m unittest discover -s tests        # from apps/psg-ads-mutations/

(no pip install required — stdlib unittest only).
"""
from __future__ import annotations

import importlib
import sys
import types
import unittest
from dataclasses import dataclass, asdict
from pathlib import Path

# Make runner.py importable when run from the package root or tests/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _install_fake(name: str, module: types.ModuleType) -> None:
    sys.modules[name] = module


class RunnerAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        # Snapshot + clear any real/fake modules so each test starts clean.
        self._saved = {
            k: v
            for k, v in sys.modules.items()
            if k.startswith("googleads_psg") or k.startswith("gtm_psg") or k == "runner"
        }
        for k in list(self._saved):
            del sys.modules[k]
        self.calls: list[str] = []

    def tearDown(self) -> None:
        for k in [
            k
            for k in sys.modules
            if k.startswith("googleads_psg") or k.startswith("gtm_psg") or k == "runner"
        ]:
            del sys.modules[k]
        sys.modules.update(self._saved)

    # ── Google Ads: campaign_bidding (dataclass-list signature) ───────────────
    def _install_google_ads_fakes(self) -> None:
        pkg = types.ModuleType("googleads_psg")
        client_mod = types.ModuleType("googleads_psg.client")
        client_mod.load_client = lambda: "FAKE_CLIENT"  # type: ignore[attr-defined]
        mutations_pkg = types.ModuleType("googleads_psg.mutations")
        cb = types.ModuleType("googleads_psg.mutations.campaign_bidding")

        calls = self.calls

        @dataclass
        class CampaignBiddingChange:
            campaign_id: int
            strategy: str
            target_cpa_micros: int | None = None
            target_roas: float | None = None

        def fetch_state(client, customer_id, campaign_ids):
            calls.append(f"fetch_state:{customer_id}:{campaign_ids}")
            return [CampaignBiddingChange(campaign_id=campaign_ids[0], strategy="MANUAL_CPC")]

        def apply_changes(client, customer_id, changes):
            calls.append(f"apply_changes:{customer_id}:{[c.campaign_id for c in changes]}")
            return [{"campaign_id": c.campaign_id, "resource_name": "rn"} for c in changes]

        cb.CampaignBiddingChange = CampaignBiddingChange  # type: ignore[attr-defined]
        cb.fetch_state = fetch_state  # type: ignore[attr-defined]
        cb.apply_changes = apply_changes  # type: ignore[attr-defined]
        cb.state_to_dicts = lambda states: [asdict(s) for s in states]  # type: ignore[attr-defined]
        cb.changes_to_dicts = lambda changes: [asdict(c) for c in changes]  # type: ignore[attr-defined]

        _install_fake("googleads_psg", pkg)
        _install_fake("googleads_psg.client", client_mod)
        _install_fake("googleads_psg.mutations", mutations_pkg)
        _install_fake("googleads_psg.mutations.campaign_bidding", cb)

    def test_campaign_bidding_dry_run_does_not_apply(self):
        self._install_google_ads_fakes()
        runner = importlib.import_module("runner")
        spec = {
            "mutationKey": "google_ads.campaign_bidding",
            "mode": "dry_run",
            "targetRef": "111",
            "params": {"changes": [{"campaign_id": 42, "strategy": "MANUAL_CPC"}]},
        }
        out = runner.dispatch(spec)
        self.assertTrue(out["ok"])
        self.assertIsNone(out["after"], "dry-run must NOT populate after")
        self.assertEqual(out["requestedChanges"][0]["campaign_id"], 42)
        self.assertEqual(out["before"][0]["campaign_id"], 42)
        # fetch ran; apply did NOT.
        self.assertTrue(any(c.startswith("fetch_state") for c in self.calls))
        self.assertFalse(any(c.startswith("apply_changes") for c in self.calls))

    def test_campaign_bidding_execute_applies(self):
        self._install_google_ads_fakes()
        runner = importlib.import_module("runner")
        spec = {
            "mutationKey": "google_ads.campaign_bidding",
            "mode": "execute",
            "targetRef": "111",
            "params": {"changes": [{"campaign_id": 42, "strategy": "MANUAL_CPC"}]},
        }
        out = runner.dispatch(spec)
        self.assertTrue(out["ok"])
        self.assertEqual(out["after"][0]["campaign_id"], 42)
        self.assertTrue(any(c.startswith("apply_changes") for c in self.calls))
        # The mirrored log carries the same diff.
        self.assertEqual(out["log"]["op"], "google_ads.campaign_bidding")
        self.assertEqual(out["log"]["mode"], "execute")

    # ── GTM: tag_paused (container→workspace→tag path walk) ────────────────────
    def _install_gtm_fakes(self, tag_found: bool = True) -> None:
        pkg = types.ModuleType("gtm_psg")
        client_mod = types.ModuleType("gtm_psg.client")
        client_mod.load_gtm_service = lambda: "FAKE_SERVICE"  # type: ignore[attr-defined]
        mutations_pkg = types.ModuleType("gtm_psg.mutations")
        tags = types.ModuleType("gtm_psg.mutations.tags")
        calls = self.calls

        def resolve_container(service, public_id):
            calls.append(f"resolve_container:{public_id}")
            return {"path": "accounts/1/containers/2", "publicId": public_id}

        def get_default_workspace(service, container_path):
            calls.append("get_default_workspace")
            return {"path": container_path + "/workspaces/3", "name": "Default Workspace"}

        def list_tags(service, workspace_path):
            calls.append("list_tags")
            return [{"name": "GA4", "path": workspace_path + "/tags/9", "paused": False}] if tag_found else []

        def find_tag(tags_list, name):
            for t in tags_list:
                if t.get("name") == name:
                    return t
            return None

        def set_tag_paused(service, tag_path, paused):
            calls.append(f"set_tag_paused:{tag_path}:{paused}")
            return {"name": "GA4", "tagId": "9", "paused": paused}

        tags.resolve_container = resolve_container  # type: ignore[attr-defined]
        tags.get_default_workspace = get_default_workspace  # type: ignore[attr-defined]
        tags.list_tags = list_tags  # type: ignore[attr-defined]
        tags.find_tag = find_tag  # type: ignore[attr-defined]
        tags.set_tag_paused = set_tag_paused  # type: ignore[attr-defined]

        _install_fake("gtm_psg", pkg)
        _install_fake("gtm_psg.client", client_mod)
        _install_fake("gtm_psg.mutations", mutations_pkg)
        _install_fake("gtm_psg.mutations.tags", tags)

    def test_gtm_tag_paused_dry_run_walks_but_does_not_set(self):
        self._install_gtm_fakes()
        runner = importlib.import_module("runner")
        spec = {
            "mutationKey": "gtm.tag_paused",
            "mode": "dry_run",
            "targetRef": "GTM-ABC123",
            "params": {"tag_name": "GA4", "paused": True},
        }
        out = runner.dispatch(spec)
        self.assertTrue(out["ok"])
        self.assertTrue(out["before"]["found"])
        self.assertEqual(out["before"]["paused"], False)
        self.assertEqual(out["requestedChanges"]["paused"], True)
        self.assertIsNone(out["after"])
        self.assertFalse(any(c.startswith("set_tag_paused") for c in self.calls))

    def test_gtm_tag_paused_execute_sets(self):
        self._install_gtm_fakes()
        runner = importlib.import_module("runner")
        spec = {
            "mutationKey": "gtm.tag_paused",
            "mode": "execute",
            "targetRef": "GTM-ABC123",
            "params": {"tag_name": "GA4", "paused": True},
        }
        out = runner.dispatch(spec)
        self.assertTrue(out["ok"])
        self.assertEqual(out["after"]["paused"], True)
        self.assertTrue(any(c.startswith("set_tag_paused") for c in self.calls))

    def test_gtm_tag_paused_execute_missing_tag_raises(self):
        self._install_gtm_fakes(tag_found=False)
        runner = importlib.import_module("runner")
        spec = {
            "mutationKey": "gtm.tag_paused",
            "mode": "execute",
            "targetRef": "GTM-ABC123",
            "params": {"tag_name": "GA4", "paused": True},
        }
        with self.assertRaises(ValueError):
            runner.dispatch(spec)

    # ── Validation / dispatch guards ──────────────────────────────────────────
    def test_unknown_key_raises(self):
        runner = importlib.import_module("runner")
        with self.assertRaises(ValueError):
            runner.dispatch({"mutationKey": "nope", "mode": "dry_run", "targetRef": "1"})

    def test_bad_mode_raises(self):
        runner = importlib.import_module("runner")
        with self.assertRaises(ValueError):
            runner.dispatch({"mutationKey": "gtm.tag_paused", "mode": "x", "targetRef": "1"})


if __name__ == "__main__":
    unittest.main()

import asyncio
import inspect
import json
import tempfile
import unittest
from pathlib import Path

from runtime.blackboard import EpochBlackboard, _scan_wal
from runtime.blogger import markdown_to_html, prepare_blogger_body
from runtime.text_similarity import best_similar_match, text_similarity


class SimilarityTests(unittest.TestCase):
    def test_identical_titles_match(self):
        self.assertEqual(text_similarity("Agentes de IA no Brasil", "Agentes de IA no Brasil"), 1.0)

    def test_unrelated_titles_stay_apart(self):
        score = text_similarity("receita de bolo de laranja", "protocolo de contexto para modelos")
        self.assertLess(score, 0.3)

    def test_best_match_respects_threshold(self):
        found = best_similar_match(
            "Distilação de modelos para startups",
            [("a", "Distilação de modelos para startups brasileiras"), ("b", "Receita de pão")],
            threshold=0.5,
        )
        self.assertIsNotNone(found)
        self.assertEqual(found[0], "a")
        self.assertIsNone(best_similar_match("xyz", [("a", "something else entirely")], threshold=0.9))


class BloggerBodyTests(unittest.TestCase):
    def test_horizontal_rules_are_removed(self):
        html = markdown_to_html("## Abertura\n\n---\n\nUm parágrafo.")
        self.assertNotIn("<hr", html.lower())
        self.assertIn("<h2>", html)
        self.assertIn("Um parágrafo.", html)

    def test_prepare_collapses_blank_lines(self):
        self.assertEqual(prepare_blogger_body("a\n\n\n\nb"), "a\n\nb")


class WalHydrateTests(unittest.TestCase):
    def test_scan_keeps_latest_board_node_and_skips_prose(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "wal.jsonl"
            rows = [
                {
                    "op": "ADD",
                    "data": {
                        "id": "global:task:abc",
                        "payload": {
                            "node_id": "global:task:abc",
                            "label": "Task",
                            "title": "Pauta",
                            "text": "primeira",
                            "status": "open",
                        },
                    },
                },
                {
                    "op": "ADD",
                    "data": {
                        "id": "global:task:abc",
                        "payload": {
                            "node_id": "global:task:abc",
                            "label": "Task",
                            "title": "Pauta",
                            "text": "primeira",
                            "status": "completed",
                        },
                    },
                },
                {
                    "op": "ADD",
                    "data": {
                        "id": "mem-1",
                        "payload": "Rafa delivered a brief",
                    },
                },
            ]
            path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
            latest, versions = _scan_wal(path)
            self.assertEqual(set(latest), {"global:task:abc"})
            self.assertEqual(latest["global:task:abc"]["properties"]["status"], "completed")
            self.assertEqual(versions["global:task:abc"], 2)

            board = EpochBlackboard(storage_dir=str(Path(tmp) / "board"), model=None, dim=8)
            # hydrate_registry is async; drive it without a network or a real engine.
            import asyncio

            count = asyncio.run(board.hydrate_registry(path))
            self.assertEqual(count, 1)
            self.assertEqual(board._node_registry["global:task:abc"]["properties"]["status"], "completed")


class CrewToolTests(unittest.TestCase):
    def test_description_parameter_does_not_raise_and_stays_on_one_loop(self):
        try:
            import crewai  # noqa: F401
        except ImportError:
            self.skipTest("crewai is not installed")

        from runtime.crew_loop import _as_crew_tool
        from runtime.tools import Tool

        loops: list[int] = []

        async def generate_blog_image(title: str, description: str = "") -> str:
            loops.append(id(asyncio.get_running_loop()))
            return f"{title}:{description}"

        wrapped = _as_crew_tool(
            Tool(
                generate_blog_image,
                name="generate_blog_image",
                description="Generate one cover from a title and a scene description.",
            )
        )
        structured = wrapped.to_structured_tool()
        self.assertTrue(inspect.iscoroutinefunction(structured.func))
        self.assertIn("description", structured.args_schema.model_fields)

        async def run_twice() -> str:
            first = await structured.ainvoke(
                input={"title": "Capa", "description": "sala de redação"}
            )
            second = await structured.ainvoke(input={"title": "Outra"})
            return f"{first}|{second}"

        text = asyncio.run(run_twice())
        self.assertEqual(text, "Capa:sala de redação|Outra:")
        self.assertEqual(len(loops), 2)
        self.assertEqual(loops[0], loops[1])


if __name__ == "__main__":
    unittest.main()

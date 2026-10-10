import unittest
from pathlib import Path

from blog_images import (
    cover_markdown,
    cover_path,
    cover_prompt,
    find_hosted_url,
    image_url_from_upload,
    public_image_url,
    slugify,
)


class BlogImageTests(unittest.TestCase):
    def test_slug_strips_accents(self):
        self.assertEqual(slugify("Ação de IA: modelos híbridos"), "acao-de-ia-modelos-hibridos")

    def test_cover_prompt_forbids_text(self):
        prompt = cover_prompt("Título", "um datacenter ao amanhecer")
        self.assertIn("No text", prompt)
        self.assertIn("um datacenter ao amanhecer", prompt)

    def test_markdown_line(self):
        self.assertEqual(
            cover_markdown("https://example.com/a.png"),
            '<img src="https://example.com/a.png" alt="capa">',
        )

    def test_full_size_url(self):
        raw = "https://blogger.googleusercontent.com/img/b/abc/photo.png"
        self.assertEqual(
            public_image_url(raw),
            "https://blogger.googleusercontent.com/img/b/abc/s0/photo.png",
        )
        already = "https://blogger.googleusercontent.com/img/b/abc/s0/photo.png"
        self.assertEqual(public_image_url(already), already)

    def test_nested_upload_payload(self):
        payload = {
            "sessionStatus": {
                "additionalInfo": {
                    "uploader_service.GoogleRupioAdditionalInfo": {
                        "completionInfo": {
                            "customerSpecificInfo": {
                                "url": "https://blogger.googleusercontent.com/img/b/abc/photo.png"
                            }
                        }
                    }
                }
            }
        }
        self.assertIn("/s0/photo.png", image_url_from_upload(payload))
        self.assertTrue(find_hosted_url(payload).endswith("photo.png"))

    def test_cover_stays_in_workspace(self):
        root = Path("/tmp/office-workspace")
        target = cover_path(root, "Hello World")
        self.assertEqual(target, root.resolve() / "imagens" / "hello-world.png")


if __name__ == "__main__":
    unittest.main()

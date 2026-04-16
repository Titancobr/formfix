import json
import os
from typing import Any
from urllib import error, request


class LLMCoach:
    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "ollama").strip().lower()
        self.realtime_model = os.getenv("LLM_REALTIME_MODEL", os.getenv("LLM_MODEL", "qwen2.5:3b"))
        self.report_model = os.getenv("LLM_REPORT_MODEL", os.getenv("LLM_MODEL", "qwen2.5:7b"))
        self.vision_model = os.getenv("LLM_VISION_MODEL", "llava:7b")
        self.ollama_host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.openai_model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        self._openai_client = None

        if self.provider in {"openai", "auto"} and self.api_key:
            try:
                from openai import OpenAI

                self._openai_client = OpenAI(api_key=self.api_key)
            except Exception:
                self._openai_client = None

        self.enabled = self.provider in {"ollama", "openai", "auto"}

    def realtime_correction(
        self,
        *,
        exercise_name: str,
        mistake_code: str,
        severity: int,
        reps: int,
        stage: str,
        tracked_angle: float,
        local_message: str,
    ) -> str:
        fallback = local_message
        if not self.enabled:
            return fallback

        prompt = (
            "You are a calm gym instructor giving one short live correction. "
            "Return one sentence under 18 words. "
            "If the issue is mild, encourage first. "
            "If severe, correct clearly but kindly. "
            "Do not mention AI, confidence, or numbers unless needed.\n\n"
            f"Exercise: {exercise_name}\n"
            f"Mistake code: {mistake_code}\n"
            f"Severity: {severity}\n"
            f"Rep count: {reps}\n"
            f"Stage: {stage}\n"
            f"Tracked angle: {tracked_angle:.1f}\n"
            f"Local fallback cue: {local_message}"
        )
        return self._complete_text(prompt, max_tokens=40, model=self.realtime_model) or fallback

    def exercise_report(
        self,
        *,
        exercise_name: str,
        reps: int,
        good_frame_ratio: float,
        top_mistakes: list[tuple[str, int]],
    ) -> dict[str, Any]:
        fallback = self._fallback_report(
            exercise_name=exercise_name,
            reps=reps,
            good_frame_ratio=good_frame_ratio,
            top_mistakes=top_mistakes,
        )
        if not self.enabled:
            return fallback

        prompt = (
            "You are a supportive gym coach writing a short exercise review in JSON. "
            "Return valid JSON with keys: summary, what_went_well, improve_next, coach_tip. "
            "Each value must be a short sentence. "
            "Keep it practical and human.\n\n"
            f"Exercise: {exercise_name}\n"
            f"Reps: {reps}\n"
            f"Good frame ratio: {good_frame_ratio:.2f}\n"
            f"Top mistakes: {top_mistakes}"
        )

        text = self._complete_text(prompt, max_tokens=220, model=self.report_model)
        if not text:
            return fallback

        try:
            parsed = json.loads(text)
            if all(key in parsed for key in ("summary", "what_went_well", "improve_next", "coach_tip")):
                return parsed
        except Exception:
            pass
        return fallback

    def meal_estimate(
        self,
        *,
        prompt_context: str,
        image_base64: str | None = None,
    ) -> dict[str, Any]:
        fallback = {
            "title": "Estimated meal",
            "description": "Estimated from the uploaded meal.",
            "calories": 450,
            "protein": 25,
            "carbs": 45,
            "fat": 15,
        }
        if not self.enabled:
            return fallback

        prompt = (
            "You are a nutrition assistant. Estimate calories and macros for the meal. "
            "Return valid JSON with keys: title, description, calories, protein, carbs, fat. "
            "Use integers for calories and macros. Keep the description short and practical.\n\n"
            f"{prompt_context}"
        )

        text = self._complete_text(
            prompt,
            max_tokens=180,
            model=self.vision_model if image_base64 else self.report_model,
            image_base64=image_base64,
        )
        if not text:
            return fallback

        try:
            parsed = json.loads(text)
            if all(key in parsed for key in ("title", "description", "calories", "protein", "carbs", "fat")):
                return {
                    "title": str(parsed["title"]),
                    "description": str(parsed["description"]),
                    "calories": int(float(parsed["calories"])),
                    "protein": int(float(parsed["protein"])),
                    "carbs": int(float(parsed["carbs"])),
                    "fat": int(float(parsed["fat"])),
                }
        except Exception:
            pass
        return fallback

    def _complete_text(
        self,
        prompt: str,
        *,
        max_tokens: int,
        model: str,
        image_base64: str | None = None,
    ) -> str:
        providers = self._provider_order()
        for provider in providers:
            if provider == "ollama":
                text = self._ollama_complete(
                    prompt,
                    max_tokens=max_tokens,
                    model=model,
                    image_base64=image_base64,
                )
            elif provider == "openai":
                text = self._openai_complete(prompt, max_tokens=max_tokens)
            else:
                text = ""
            if text:
                return text.strip()
        return ""

    def _provider_order(self) -> list[str]:
        if self.provider == "auto":
            order = ["ollama"]
            if self._openai_client:
                order.append("openai")
            return order
        return [self.provider]

    def _ollama_complete(
        self,
        prompt: str,
        *,
        max_tokens: int,
        model: str,
        image_base64: str | None = None,
    ) -> str:
        body = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "num_predict": max_tokens,
                "temperature": 0.2,
            },
        }
        if image_base64:
            body["images"] = [image_base64]
        payload = json.dumps(body).encode("utf-8")
        req = request.Request(
            f"{self.ollama_host}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=1.2) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return (body.get("response") or "").strip()
        except (error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            return ""

    def _openai_complete(self, prompt: str, *, max_tokens: int) -> str:
        if not self._openai_client:
            return ""
        try:
            response = self._openai_client.responses.create(
                model=self.openai_model,
                input=prompt,
                max_output_tokens=max_tokens,
            )
            return (response.output_text or "").strip()
        except Exception:
            return ""

    def _fallback_report(
        self,
        *,
        exercise_name: str,
        reps: int,
        good_frame_ratio: float,
        top_mistakes: list[tuple[str, int]],
    ) -> dict[str, Any]:
        pretty_name = exercise_name.replace("_", " ").title()
        top_issue = top_mistakes[0][0].replace("_", " ") if top_mistakes else "small form adjustments"
        percent = round(good_frame_ratio * 100)
        return {
            "summary": f"You completed {reps} reps of {pretty_name} with about {percent}% solid form.",
            "what_went_well": "Your control looked better once you settled into a consistent rhythm.",
            "improve_next": f"Focus most on {top_issue} during the next set.",
            "coach_tip": "Use a smooth tempo and pause briefly in the strongest part of each rep.",
        }

import base64
import os
import sys
import time
from pathlib import Path
from datetime import datetime, date

import cv2
import numpy as np
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import models, database, auth
from pydantic import BaseModel
import uvicorn
from dotenv import load_dotenv

# Load .env automatically
load_dotenv()

AI_TRAINER_ROOT = Path(__file__).resolve().parents[2]
if str(AI_TRAINER_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_TRAINER_ROOT))

from core.rep_counter import RepCounter
from utils.config import EXERCISE_CONFIGS
from llm_coach import LLMCoach

# 1. Initialize the app
app = FastAPI()

# 2. CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # put your frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Create DB tables (auth + progress tracking).
try:
    with database.engine.connect():
        print("Connected to SQL database successfully!")
    models.Base.metadata.create_all(bind=database.engine)
except Exception as e:
    print("Database setup failed:", e)

# 4. Schemas
class UserSchema(BaseModel):
    email: str
    password: str


class AnalyzeFrameSchema(BaseModel):
    image: str
    exercise: str = "bicep_curl"
    session_id: str = "default"
    reset: bool = False
    include_landmarks: bool = False


class SessionReportSchema(BaseModel):
    session_id: str
    exercise: str = "bicep_curl"


class WorkoutExerciseUpdateSchema(BaseModel):
    user_id: int
    plan_id: str
    day_id: str
    day_name: str
    exercise_id: str
    exercise_name: str
    reps: int = 0
    completed: bool = False
    status: str = "in_progress"
    total_exercises: int = 0


class NutritionProfileSchema(BaseModel):
    user_id: int
    age: int | None = None
    sex: str = "unspecified"
    height_cm: float | None = None
    weight_kg: float | None = None
    activity_level: str = "moderate"
    goal_type: str = "maintain"


class RecipeSchema(BaseModel):
    user_id: int
    title: str
    description: str = ""
    ingredients: str = ""
    instructions: str = ""
    meal_type: str = "lunch"
    calories: int = 0
    protein: int = 0
    carbs: int = 0
    fat: int = 0
    image_data: str | None = None


class MealEntrySchema(BaseModel):
    user_id: int
    date_key: str | None = None
    meal_type: str = "lunch"
    source: str = "manual"
    title: str
    description: str = ""
    calories: int = 0
    protein: int = 0
    carbs: int = 0
    fat: int = 0
    image_data: str | None = None
    recipe_id: int | None = None
    consumed_at_label: str = ""


class MealScanSchema(BaseModel):
    user_id: int
    image: str | None = None
    meal_hint: str = ""
    meal_type: str = "lunch"
    add_to_day: bool = True
    date_key: str | None = None
    consumed_at_label: str = ""


pose_estimator = None
feature_extractor = None
posture_analyzer = None
session_counters: dict[str, RepCounter] = {}
session_feedback_stats: dict[str, dict] = {}
llm_coach = LLMCoach()

ANGLE_DESCRIPTIONS = {
    "avg_elbow": {
        "label": "Elbow angle",
        "definition": "shoulder-elbow-wrist",
    },
    "avg_knee": {
        "label": "Knee angle",
        "definition": "hip-knee-ankle",
    },
    "avg_hip": {
        "label": "Hip angle",
        "definition": "shoulder-hip-knee",
    },
    "avg_shoulder": {
        "label": "Shoulder angle",
        "definition": "elbow-shoulder-hip",
    },
}


EXERCISE_ALIASES = {
    "barbell biceps curl": "bicep_curl",
    "barbell curls": "bicep_curl",
    "barbell curl": "bicep_curl",
    "bicep curl": "bicep_curl",
    "biceps curl": "bicep_curl",
    "hammer curls": "hammer_curl",
    "hammer curl": "hammer_curl",
    "pull-ups": "pull_up",
    "pull ups": "pull_up",
    "pull up": "pull_up",
    "push-up": "push_up",
    "push-ups": "push_up",
    "push up": "push_up",
    "barbell squats": "barbell_squat",
    "barbell squat": "barbell_squat",
    "squats": "barbell_squat",
    "squat": "barbell_squat",
    "bench press": "barbell_bench_press",
    "barbell bench press": "barbell_bench_press",
    "overhead press": "overhead_press",
    "shoulder press": "overhead_press",
    "lat pulldowns": "lat_pulldown",
    "lat pulldown": "lat_pulldown",
    "lateral raises": "lateral_raise",
    "lateral raise": "lateral_raise",
    "deadlift": "deadlift",
    "romanian deadlift": "romanian_deadlift",
    "barbell rows": "barbell_row",
    "rows": "barbell_row",
    "seated cable row": "seated_cable_row",
    "face pulls": "face_pull",
    "dips": "dips",
    "tricep pushdowns": "tricep_pushdown",
    "skull crushers": "skull_crusher",
    "overhead tricep extension": "overhead_tricep_extension",
    "squats": "squat",
    "calf raises": "calf_raise",
    "leg curls": "romanian_deadlift",
    "leg extensions": "squat",
    "leg press": "squat",
    "bulgarian split squats": "bulgarian_split_squat",
    "military press": "military_press",
    "flat bench press": "flat_bench_press",
    "incline bench press": "incline_bench_press",
    "incline dumbbell fly": "incline_dumbbell_fly",
    "cable flyes": "cable_fly",
    "dumbbell flyes": "dumbbell_fly",
    "shrugs": "overhead_press",
    "reverse flyes": "face_pull",
    "preacher curls": "preacher_curl",
    "barbell curls": "barbell_curl",
    "hammer curls": "hammer_curl",
}


def normalize_exercise(exercise: str) -> str:
    cleaned = exercise.strip().lower().replace("_", " ").replace("-", " ")
    mapped = EXERCISE_ALIASES.get(cleaned, cleaned.replace(" ", "_"))
    return mapped if mapped in EXERCISE_CONFIGS else "bicep_curl"


def tracked_angle_meta(exercise_config):
    default_label = getattr(exercise_config, "tracked_angle_label", "Tracked angle")
    meta = ANGLE_DESCRIPTIONS.get(exercise_config.rep_metric, {})
    return {
        "label": meta.get("label", default_label),
        "definition": meta.get("definition", default_label.lower()),
    }


def coach_message(exercise_name: str, posture_result: dict, reps: int) -> str:
    if posture_result.get("is_good", False):
        if reps and reps % 5 == 0:
            return "Nice control. Keep breathing and stay smooth."
        return "Great rep. Keep this rhythm."

    code = posture_result.get("mistake_code", "")
    friendly_map = {
        "incomplete_contraction": "Almost there. Squeeze a bit more at the top.",
        "insufficient_depth": "Good effort. Go slightly deeper for a cleaner rep.",
        "insufficient_height": "Lift a little higher until your arms reach shoulder level.",
        "too_deep": "Great intent. Come up a little to keep control.",
        "too_high": "Nice control. Stop around shoulder height.",
        "elbow_instability": "Keep your elbows steady and move with control.",
        "knee_instability": "Track your knees evenly. Stay balanced through both legs.",
        "arm_imbalance": "Raise both arms evenly and stay tall through your torso.",
        "hip_sag": "Brace your core and keep your hips in line.",
        "overflexion": "Control the top. Do not over-squeeze.",
        "incomplete_lockout": "Finish the rep fully at the top.",
        "overfolding": "Keep your chest proud and hinge with control."
    }
    return friendly_map.get(code, posture_result.get("message", "Adjust your form slightly and continue."))


def should_request_llm(session: dict, posture_result: dict) -> bool:
    if not llm_coach.enabled:
        return False
    if posture_result.get("is_good", False):
        return False
    severity = int(posture_result.get("severity", 1))
    if severity < 2:
        return False

    current_time = time.time()
    last_time = float(session.get("last_llm_time", 0))
    current_code = posture_result.get("mistake_code", "form_issue")
    recent_codes = session.get("recent_codes", [])
    repeated = len(recent_codes) >= 4 and recent_codes[-4:].count(current_code) >= 3
    return repeated and (current_time - last_time) >= 4.0


def update_session_stats(session_id: str, posture_result: dict, reset: bool) -> dict:
    session = session_feedback_stats.get(session_id)
    if reset or session is None:
        session = {
            "frames": 0,
            "good_frames": 0,
            "mistakes": {},
            "recent_codes": [],
            "last_llm_time": 0.0,
            "last_correction": "",
            "exercise": None,
            "reps": 0,
            "last_rep_count": 0,
            "current_rep_frames": 0,
            "current_rep_good_frames": 0,
            "current_rep_mistakes": {},
            "perfect_reps": 0,
            "corrected_reps": 0,
            "rep_reports": [],
        }
        session_feedback_stats[session_id] = session

    session["frames"] += 1
    if posture_result.get("is_good", False):
        session["good_frames"] += 1
        code = "good_form"
        session["current_rep_good_frames"] += 1
    else:
        code = posture_result.get("mistake_code", "form_issue")
        session["mistakes"][code] = session["mistakes"].get(code, 0) + 1
        current_rep_mistakes = session["current_rep_mistakes"]
        current_rep_mistakes[code] = current_rep_mistakes.get(code, 0) + 1

    session["current_rep_frames"] += 1

    recent_codes = session["recent_codes"]
    recent_codes.append(code)
    if len(recent_codes) > 8:
        del recent_codes[:-8]

    return session


def finalize_rep(session: dict, reps: int):
    rep_frames = max(int(session.get("current_rep_frames", 0)), 1)
    good_frames = int(session.get("current_rep_good_frames", 0))
    rep_mistakes = dict(session.get("current_rep_mistakes", {}))
    quality = good_frames / rep_frames
    dominant_mistake = ""
    if rep_mistakes:
        dominant_mistake = max(rep_mistakes.items(), key=lambda item: item[1])[0]

    if quality >= 0.75 and not dominant_mistake:
        session["perfect_reps"] += 1
        verdict = "perfect"
    else:
        session["corrected_reps"] += 1
        verdict = "needs_work"

    session["rep_reports"].append(
        {
            "rep_number": reps,
            "quality_score": round(quality * 100),
            "verdict": verdict,
            "main_issue": dominant_mistake,
        }
    )

    session["current_rep_frames"] = 0
    session["current_rep_good_frames"] = 0
    session["current_rep_mistakes"] = {}


def decode_frame(image_data: str):
    encoded = image_data.split(",", 1)[-1]
    image_bytes = base64.b64decode(encoded)
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image frame")
    return frame


def today_key() -> str:
    return date.today().isoformat()


def clean_image_payload(image_data: str | None) -> str | None:
    if not image_data:
        return None
    return image_data.split(",", 1)[-1]


def calculate_targets(
    *,
    sex: str,
    age: int | None,
    height_cm: float | None,
    weight_kg: float | None,
    activity_level: str,
    goal_type: str,
) -> dict:
    if not height_cm or not weight_kg or not age:
        base_calories = 2200
    else:
        sex_key = (sex or "unspecified").strip().lower()
        if sex_key == "male":
            bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
        elif sex_key == "female":
            bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
        else:
            bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age

        activity_map = {
            "sedentary": 1.2,
            "light": 1.375,
            "moderate": 1.55,
            "active": 1.725,
            "very_active": 1.9,
        }
        maintenance = bmr * activity_map.get(activity_level, 1.55)
        goal_adjustment = {
            "weight_loss": -350,
            "lose_fat": -350,
            "maintain": 0,
            "weight_gain": 300,
            "build_muscle": 220,
        }.get(goal_type, 0)
        base_calories = max(1400, int(round(maintenance + goal_adjustment)))

    protein = int(round(max(110, base_calories * 0.28 / 4)))
    fat = int(round(max(45, base_calories * 0.25 / 9)))
    carbs = int(round(max(100, (base_calories - (protein * 4 + fat * 9)) / 4)))
    return {
        "target_calories": int(base_calories),
        "target_protein": protein,
        "target_carbs": carbs,
        "target_fat": fat,
    }


def recipe_payload(recipe) -> dict:
    return {
        "id": recipe.id,
        "user_id": recipe.user_id,
        "title": recipe.title,
        "description": recipe.description,
        "ingredients": recipe.ingredients,
        "instructions": recipe.instructions,
        "meal_type": recipe.meal_type,
        "calories": recipe.calories,
        "protein": recipe.protein,
        "carbs": recipe.carbs,
        "fat": recipe.fat,
        "image_data": recipe.image_data,
        "created_at": recipe.created_at.isoformat() if recipe.created_at else None,
        "updated_at": recipe.updated_at.isoformat() if recipe.updated_at else None,
    }


def meal_payload(meal) -> dict:
    return {
        "id": meal.id,
        "user_id": meal.user_id,
        "date_key": meal.date_key,
        "meal_type": meal.meal_type,
        "source": meal.source,
        "title": meal.title,
        "description": meal.description,
        "calories": meal.calories,
        "protein": meal.protein,
        "carbs": meal.carbs,
        "fat": meal.fat,
        "image_data": meal.image_data,
        "recipe_id": meal.recipe_id,
        "consumed_at_label": meal.consumed_at_label,
        "created_at": meal.created_at.isoformat() if meal.created_at else None,
        "updated_at": meal.updated_at.isoformat() if meal.updated_at else None,
    }


def get_counter(session_id: str, exercise_config, reset: bool):
    counter = session_counters.get(session_id)
    if reset or counter is None or counter.exercise_config.name != exercise_config.name:
        counter = RepCounter(exercise_config)
        session_counters[session_id] = counter
    return counter


def get_ai_components():
    global pose_estimator, feature_extractor, posture_analyzer
    from core.feature_extractor import FeatureExtractor
    from core.pose_estimator import PoseEstimator
    from core.posture_rules import PostureAnalyzer

    if pose_estimator is None:
        pose_estimator = PoseEstimator()
    if feature_extractor is None:
        feature_extractor = FeatureExtractor()
    if posture_analyzer is None:
        posture_analyzer = PostureAnalyzer()
    return pose_estimator, feature_extractor, posture_analyzer


def session_summary_payload(session_id: str, exercise_name: str, reps: int) -> dict:
    session = session_feedback_stats.get(session_id) or {}
    frames = max(int(session.get("frames", 0)), 1)
    good_frames = int(session.get("good_frames", 0))
    mistakes = session.get("mistakes", {})
    good_ratio = good_frames / frames
    top_mistakes = sorted(mistakes.items(), key=lambda item: item[1], reverse=True)[:3]
    common_mistakes = [code for code, _ in top_mistakes]
    perfect_reps = int(session.get("perfect_reps", 0))
    corrected_reps = int(session.get("corrected_reps", 0))
    rep_reports = list(session.get("rep_reports", []))
    what_went_right = []
    if good_ratio >= 0.8:
        what_went_right.append("You stayed controlled through most of the set.")
    if perfect_reps > 0:
        what_went_right.append(f"{perfect_reps} reps were clean and well controlled.")
    if reps >= 8:
        what_went_right.append("You built enough consistency to finish a meaningful working set.")

    improvement_map = {
        "elbow_instability": "Keep the elbows steadier and let the target joint lead the motion.",
        "insufficient_depth": "Use a little more range on the hardest part of the rep.",
        "insufficient_height": "Bring the working limb slightly higher before reversing.",
        "incomplete_lockout": "Finish the rep fully before starting the next one.",
        "hip_sag": "Brace the core harder so the body stays stacked.",
        "knee_instability": "Track both knees more evenly and keep pressure balanced.",
        "arm_imbalance": "Match left and right sides more closely throughout the rep.",
        "overfolding": "Keep the torso position more stable and avoid collapsing forward.",
    }
    what_went_wrong = [improvement_map.get(code, code.replace("_", " ")) for code, _ in top_mistakes]
    report = llm_coach.exercise_report(
        exercise_name=exercise_name,
        reps=reps,
        good_frame_ratio=good_ratio,
        top_mistakes=top_mistakes,
    )
    return {
        "exercise": exercise_name,
        "reps": reps,
        "accuracy": round(good_ratio * 100),
        "perfect_reps": perfect_reps,
        "corrected_reps": corrected_reps,
        "common_mistakes": common_mistakes,
        "what_went_right": what_went_right,
        "what_went_wrong": what_went_wrong,
        "rep_breakdown": rep_reports,
        "report": report,
    }

# 5. Register endpoint
@app.post("/register")
def register_user(user_data: UserSchema, db: Session = Depends(database.get_db)):
    existing_user = db.query(models.User).filter(models.User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already exists!")
    new_user = models.User(
        email=user_data.email,
        hashed_password=auth.hash_password(user_data.password)
    )
    db.add(new_user)
    db.commit()
    return {"message": "User created successfully!"}

# 6. Login endpoint
@app.post("/login")
def login_user(user_data: UserSchema, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.email == user_data.email).first()
    if not user or not auth.verify_password(user_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"message": "Login successful!", "user_id": user.id, "email": user.email}


@app.get("/nutrition/profile/{user_id}")
def get_nutrition_profile(user_id: int, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    profile = db.query(models.NutritionProfile).filter(models.NutritionProfile.user_id == user_id).first()
    if not profile:
        defaults = calculate_targets(
            sex="unspecified",
            age=None,
            height_cm=None,
            weight_kg=None,
            activity_level="moderate",
            goal_type="maintain",
        )
        return {
            "user_id": user_id,
            "age": None,
            "sex": "unspecified",
            "height_cm": None,
            "weight_kg": None,
            "activity_level": "moderate",
            "goal_type": "maintain",
            **defaults,
        }

    return {
        "user_id": profile.user_id,
        "age": profile.age,
        "sex": profile.sex,
        "height_cm": profile.height_cm,
        "weight_kg": profile.weight_kg,
        "activity_level": profile.activity_level,
        "goal_type": profile.goal_type,
        "target_calories": profile.target_calories,
        "target_protein": profile.target_protein,
        "target_carbs": profile.target_carbs,
        "target_fat": profile.target_fat,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


@app.post("/nutrition/profile")
def upsert_nutrition_profile(payload: NutritionProfileSchema, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    targets = calculate_targets(
        sex=payload.sex,
        age=payload.age,
        height_cm=payload.height_cm,
        weight_kg=payload.weight_kg,
        activity_level=payload.activity_level,
        goal_type=payload.goal_type,
    )
    profile = db.query(models.NutritionProfile).filter(models.NutritionProfile.user_id == payload.user_id).first()
    now = datetime.utcnow()
    if not profile:
        profile = models.NutritionProfile(
            user_id=payload.user_id,
            age=payload.age,
            sex=payload.sex,
            height_cm=payload.height_cm,
            weight_kg=payload.weight_kg,
            activity_level=payload.activity_level,
            goal_type=payload.goal_type,
            updated_at=now,
            **targets,
        )
        db.add(profile)
    else:
        profile.age = payload.age
        profile.sex = payload.sex
        profile.height_cm = payload.height_cm
        profile.weight_kg = payload.weight_kg
        profile.activity_level = payload.activity_level
        profile.goal_type = payload.goal_type
        profile.target_calories = targets["target_calories"]
        profile.target_protein = targets["target_protein"]
        profile.target_carbs = targets["target_carbs"]
        profile.target_fat = targets["target_fat"]
        profile.updated_at = now

    db.commit()
    return {
        "message": "Nutrition profile saved",
        "profile": {
            "user_id": profile.user_id,
            "age": profile.age,
            "sex": profile.sex,
            "height_cm": profile.height_cm,
            "weight_kg": profile.weight_kg,
            "activity_level": profile.activity_level,
            "goal_type": profile.goal_type,
            "target_calories": profile.target_calories,
            "target_protein": profile.target_protein,
            "target_carbs": profile.target_carbs,
            "target_fat": profile.target_fat,
        },
    }


@app.get("/nutrition/recipes/{user_id}")
def list_recipes(user_id: int, db: Session = Depends(database.get_db)):
    rows = (
        db.query(models.Recipe)
        .filter(models.Recipe.user_id == user_id)
        .order_by(models.Recipe.updated_at.desc(), models.Recipe.created_at.desc())
        .all()
    )
    return {"recipes": [recipe_payload(row) for row in rows]}


@app.post("/nutrition/recipes")
def create_recipe(payload: RecipeSchema, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.utcnow()
    recipe = models.Recipe(
        user_id=payload.user_id,
        title=payload.title,
        description=payload.description,
        ingredients=payload.ingredients,
        instructions=payload.instructions,
        meal_type=payload.meal_type,
        calories=max(0, payload.calories),
        protein=max(0, payload.protein),
        carbs=max(0, payload.carbs),
        fat=max(0, payload.fat),
        image_data=payload.image_data,
        created_at=now,
        updated_at=now,
    )
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return {"message": "Recipe created", "recipe": recipe_payload(recipe)}


@app.put("/nutrition/recipes/{recipe_id}")
def update_recipe(recipe_id: int, payload: RecipeSchema, db: Session = Depends(database.get_db)):
    recipe = db.query(models.Recipe).filter(models.Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.user_id != payload.user_id:
        raise HTTPException(status_code=403, detail="Recipe does not belong to this user")

    recipe.title = payload.title
    recipe.description = payload.description
    recipe.ingredients = payload.ingredients
    recipe.instructions = payload.instructions
    recipe.meal_type = payload.meal_type
    recipe.calories = max(0, payload.calories)
    recipe.protein = max(0, payload.protein)
    recipe.carbs = max(0, payload.carbs)
    recipe.fat = max(0, payload.fat)
    recipe.image_data = payload.image_data
    recipe.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(recipe)
    return {"message": "Recipe updated", "recipe": recipe_payload(recipe)}


@app.delete("/nutrition/recipes/{recipe_id}")
def delete_recipe(recipe_id: int, user_id: int, db: Session = Depends(database.get_db)):
    recipe = db.query(models.Recipe).filter(models.Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.user_id != user_id:
        raise HTTPException(status_code=403, detail="Recipe does not belong to this user")
    db.delete(recipe)
    db.commit()
    return {"message": "Recipe deleted"}


@app.get("/nutrition/day/{user_id}")
def nutrition_day(user_id: int, date_key: str | None = None, db: Session = Depends(database.get_db)):
    profile = db.query(models.NutritionProfile).filter(models.NutritionProfile.user_id == user_id).first()
    selected_date = date_key or today_key()
    entries = (
        db.query(models.MealEntry)
        .filter(
            models.MealEntry.user_id == user_id,
            models.MealEntry.date_key == selected_date,
        )
        .order_by(models.MealEntry.created_at.asc())
        .all()
    )

    totals = {
        "calories": sum(entry.calories or 0 for entry in entries),
        "protein": sum(entry.protein or 0 for entry in entries),
        "carbs": sum(entry.carbs or 0 for entry in entries),
        "fat": sum(entry.fat or 0 for entry in entries),
    }
    targets = {
        "target_calories": profile.target_calories if profile else 2200,
        "target_protein": profile.target_protein if profile else 130,
        "target_carbs": profile.target_carbs if profile else 220,
        "target_fat": profile.target_fat if profile else 70,
    }

    meal_blocks = {"breakfast": [], "lunch": [], "dinner": [], "snack": []}
    for entry in entries:
        meal_blocks.setdefault(entry.meal_type or "snack", []).append(meal_payload(entry))

    remaining = {
        "calories": max(0, targets["target_calories"] - totals["calories"]),
        "protein": max(0, targets["target_protein"] - totals["protein"]),
        "carbs": max(0, targets["target_carbs"] - totals["carbs"]),
        "fat": max(0, targets["target_fat"] - totals["fat"]),
    }

    suggestion_context = (
        f"Goal type: {profile.goal_type if profile else 'maintain'}\n"
        f"Remaining calories: {remaining['calories']}\n"
        f"Remaining protein: {remaining['protein']}\n"
        f"Remaining carbs: {remaining['carbs']}\n"
        f"Remaining fat: {remaining['fat']}"
    )
    suggestion = llm_coach.meal_estimate(prompt_context=suggestion_context, image_base64=None)

    return {
        "date_key": selected_date,
        "targets": targets,
        "totals": totals,
        "remaining": remaining,
        "meals": meal_blocks,
        "suggested_meal": suggestion,
    }


@app.post("/nutrition/meals")
def create_meal_entry(payload: MealEntrySchema, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    now = datetime.utcnow()
    entry = models.MealEntry(
        user_id=payload.user_id,
        date_key=payload.date_key or today_key(),
        meal_type=payload.meal_type,
        source=payload.source,
        title=payload.title,
        description=payload.description,
        calories=max(0, payload.calories),
        protein=max(0, payload.protein),
        carbs=max(0, payload.carbs),
        fat=max(0, payload.fat),
        image_data=payload.image_data,
        recipe_id=payload.recipe_id,
        consumed_at_label=payload.consumed_at_label,
        created_at=now,
        updated_at=now,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"message": "Meal added", "meal": meal_payload(entry)}


@app.put("/nutrition/meals/{meal_id}")
def update_meal_entry(meal_id: int, payload: MealEntrySchema, db: Session = Depends(database.get_db)):
    entry = db.query(models.MealEntry).filter(models.MealEntry.id == meal_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Meal not found")
    if entry.user_id != payload.user_id:
        raise HTTPException(status_code=403, detail="Meal does not belong to this user")

    entry.date_key = payload.date_key or entry.date_key
    entry.meal_type = payload.meal_type
    entry.source = payload.source
    entry.title = payload.title
    entry.description = payload.description
    entry.calories = max(0, payload.calories)
    entry.protein = max(0, payload.protein)
    entry.carbs = max(0, payload.carbs)
    entry.fat = max(0, payload.fat)
    entry.image_data = payload.image_data
    entry.recipe_id = payload.recipe_id
    entry.consumed_at_label = payload.consumed_at_label
    entry.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)
    return {"message": "Meal updated", "meal": meal_payload(entry)}


@app.delete("/nutrition/meals/{meal_id}")
def delete_meal_entry(meal_id: int, user_id: int, db: Session = Depends(database.get_db)):
    entry = db.query(models.MealEntry).filter(models.MealEntry.id == meal_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Meal not found")
    if entry.user_id != user_id:
        raise HTTPException(status_code=403, detail="Meal does not belong to this user")
    db.delete(entry)
    db.commit()
    return {"message": "Meal deleted"}


@app.post("/nutrition/scan")
def scan_meal(payload: MealScanSchema, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    image_b64 = clean_image_payload(payload.image)
    context = (
        "Estimate nutrition for the uploaded meal image. "
        f"Meal hint: {payload.meal_hint or 'No hint provided'}\n"
        f"Meal type: {payload.meal_type}"
    )
    estimate = llm_coach.meal_estimate(prompt_context=context, image_base64=image_b64)
    meal = None
    if payload.add_to_day:
        now = datetime.utcnow()
        meal = models.MealEntry(
            user_id=payload.user_id,
            date_key=payload.date_key or today_key(),
            meal_type=payload.meal_type,
            source="scan",
            title=estimate["title"],
            description=estimate["description"],
            calories=max(0, estimate["calories"]),
            protein=max(0, estimate["protein"]),
            carbs=max(0, estimate["carbs"]),
            fat=max(0, estimate["fat"]),
            image_data=payload.image,
            consumed_at_label=payload.consumed_at_label,
            created_at=now,
            updated_at=now,
        )
        db.add(meal)
        db.commit()
        db.refresh(meal)

    return {
        "estimate": estimate,
        "meal": meal_payload(meal) if meal else None,
        "added_to_day": bool(meal),
    }


@app.post("/progress/exercise")
def upsert_exercise_progress(payload: WorkoutExerciseUpdateSchema, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    exercise_progress = (
        db.query(models.WorkoutExerciseProgress)
        .filter(
            models.WorkoutExerciseProgress.user_id == payload.user_id,
            models.WorkoutExerciseProgress.plan_id == payload.plan_id,
            models.WorkoutExerciseProgress.day_id == payload.day_id,
            models.WorkoutExerciseProgress.exercise_id == payload.exercise_id,
        )
        .first()
    )

    now = datetime.utcnow()
    status = (payload.status or "in_progress").strip().lower()
    if payload.completed:
        status = "completed"
    if status not in {"in_progress", "completed", "skipped"}:
        status = "in_progress"

    if not exercise_progress:
        exercise_progress = models.WorkoutExerciseProgress(
            user_id=payload.user_id,
            plan_id=payload.plan_id,
            day_id=payload.day_id,
            exercise_id=payload.exercise_id,
            exercise_name=payload.exercise_name,
            reps=payload.reps,
            completed=status == "completed",
            completed_at=now if status == "completed" else None,
            updated_at=now,
        )
        db.add(exercise_progress)
    else:
        exercise_progress.reps = max(exercise_progress.reps or 0, payload.reps)
        exercise_progress.exercise_name = payload.exercise_name
        if status == "completed" and not exercise_progress.completed:
            exercise_progress.completed = True
            exercise_progress.completed_at = now
        elif status != "completed":
            exercise_progress.completed = False
            exercise_progress.completed_at = None
        exercise_progress.updated_at = now

    exercise_status = (
        db.query(models.WorkoutExerciseStatus)
        .filter(
            models.WorkoutExerciseStatus.user_id == payload.user_id,
            models.WorkoutExerciseStatus.plan_id == payload.plan_id,
            models.WorkoutExerciseStatus.day_id == payload.day_id,
            models.WorkoutExerciseStatus.exercise_id == payload.exercise_id,
        )
        .first()
    )

    if not exercise_status:
        exercise_status = models.WorkoutExerciseStatus(
            user_id=payload.user_id,
            plan_id=payload.plan_id,
            day_id=payload.day_id,
            exercise_id=payload.exercise_id,
            exercise_name=payload.exercise_name,
            status=status,
            reps=max(0, payload.reps),
            updated_at=now,
        )
        db.add(exercise_status)
    else:
        exercise_status.exercise_name = payload.exercise_name
        exercise_status.reps = max(exercise_status.reps or 0, payload.reps)
        exercise_status.status = status
        exercise_status.updated_at = now

    day_progress = (
        db.query(models.WorkoutDayProgress)
        .filter(
            models.WorkoutDayProgress.user_id == payload.user_id,
            models.WorkoutDayProgress.plan_id == payload.plan_id,
            models.WorkoutDayProgress.day_id == payload.day_id,
        )
        .first()
    )

    if not day_progress:
        day_progress = models.WorkoutDayProgress(
            user_id=payload.user_id,
            plan_id=payload.plan_id,
            day_id=payload.day_id,
            day_name=payload.day_name,
            total_exercises=payload.total_exercises or 0,
            completed_exercises=0,
            status="in_progress",
            started_at=now,
            updated_at=now,
        )
        db.add(day_progress)

    completed_count = (
        db.query(models.WorkoutExerciseStatus)
        .filter(
            models.WorkoutExerciseStatus.user_id == payload.user_id,
            models.WorkoutExerciseStatus.plan_id == payload.plan_id,
            models.WorkoutExerciseStatus.day_id == payload.day_id,
            models.WorkoutExerciseStatus.status == "completed",
        )
        .count()
    )
    skipped_count = (
        db.query(models.WorkoutExerciseStatus)
        .filter(
            models.WorkoutExerciseStatus.user_id == payload.user_id,
            models.WorkoutExerciseStatus.plan_id == payload.plan_id,
            models.WorkoutExerciseStatus.day_id == payload.day_id,
            models.WorkoutExerciseStatus.status == "skipped",
        )
        .count()
    )

    day_progress.day_name = payload.day_name
    day_progress.total_exercises = payload.total_exercises or day_progress.total_exercises
    day_progress.completed_exercises = completed_count
    day_progress.updated_at = now

    if day_progress.total_exercises > 0 and completed_count >= day_progress.total_exercises:
        day_progress.status = "completed"
        day_progress.completed_at = now
    else:
        day_progress.status = "in_progress"
        day_progress.completed_at = None

    db.commit()
    return {
        "message": "Progress updated",
        "day_status": day_progress.status,
        "exercise_status": status,
        "completed_exercises": day_progress.completed_exercises,
        "total_exercises": day_progress.total_exercises,
        "skipped_exercises": skipped_count,
    }


@app.get("/progress/summary/{user_id}")
def progress_summary(user_id: int, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    day_rows = (
        db.query(models.WorkoutDayProgress)
        .filter(models.WorkoutDayProgress.user_id == user_id)
        .order_by(models.WorkoutDayProgress.updated_at.desc())
        .all()
    )

    completed_days = [row for row in day_rows if row.status == "completed"]
    in_progress_rows = [row for row in day_rows if row.status != "completed"]
    pending_previous = in_progress_rows[0] if in_progress_rows else None

    workout_dates = set()
    for row in completed_days:
        if row.completed_at:
            workout_dates.add(row.completed_at.date().isoformat())

    return {
        "user_id": user_id,
        "days_worked_out": len(workout_dates),
        "completed_workout_days": len(completed_days),
        "total_days_in_records": len(day_rows),
        "current_position": {
            "plan_id": in_progress_rows[0].plan_id if in_progress_rows else None,
            "day_id": in_progress_rows[0].day_id if in_progress_rows else None,
            "day_name": in_progress_rows[0].day_name if in_progress_rows else None,
            "completed_exercises": in_progress_rows[0].completed_exercises if in_progress_rows else 0,
            "total_exercises": in_progress_rows[0].total_exercises if in_progress_rows else 0,
        },
        "pending_previous_workout": {
            "plan_id": pending_previous.plan_id if pending_previous else None,
            "day_id": pending_previous.day_id if pending_previous else None,
            "day_name": pending_previous.day_name if pending_previous else None,
            "completed_exercises": pending_previous.completed_exercises if pending_previous else 0,
            "total_exercises": pending_previous.total_exercises if pending_previous else 0,
        },
    }


@app.get("/progress/day/{user_id}/{plan_id}/{day_id}")
def day_progress(user_id: int, plan_id: str, day_id: str, db: Session = Depends(database.get_db)):
    rows = (
        db.query(models.WorkoutExerciseStatus)
        .filter(
            models.WorkoutExerciseStatus.user_id == user_id,
            models.WorkoutExerciseStatus.plan_id == plan_id,
            models.WorkoutExerciseStatus.day_id == day_id,
        )
        .all()
    )
    completed = [row.exercise_id for row in rows if row.status == "completed"]
    skipped = [row.exercise_id for row in rows if row.status == "skipped"]
    in_progress = [row.exercise_id for row in rows if row.status == "in_progress"]

    return {
        "completed": completed,
        "skipped": skipped,
        "in_progress": in_progress,
    }


@app.post("/ai/analyze-frame")
def analyze_frame(payload: AnalyzeFrameSchema):
    exercise_key = normalize_exercise(payload.exercise)
    if exercise_key not in EXERCISE_CONFIGS:
        exercise_key = "bicep_curl"

    exercise = EXERCISE_CONFIGS[exercise_key]
    counter = get_counter(payload.session_id, exercise, payload.reset)
    frame = decode_frame(payload.image)
    pose, extractor, analyzer = get_ai_components()
    landmarks, _ = pose.detect(frame)

    if not landmarks:
        return {
            "exercise": exercise.name,
            "display_name": exercise.display_name,
            "confidence": 0.0,
            "reps": counter.counter,
            "stage": counter.stage,
            "correction": "Move fully into frame so I can coach your form.",
            "landmarks": [],
            "tracked_angle": 0.0,
            "tracked_angle_label": tracked_angle_meta(exercise)["label"],
            "tracked_angle_definition": tracked_angle_meta(exercise)["definition"],
            "accuracy": 0,
            "common_mistake": "",
            "ready": False,
        }

    angles = extractor.extract_angles(landmarks)
    reps, stage, tracked_angle = counter.update(angles)
    posture_result = analyzer.analyze(exercise, angles)
    correction = coach_message(exercise.name, posture_result, reps)
    session = update_session_stats(payload.session_id, posture_result, payload.reset)
    session["exercise"] = exercise.name
    session["reps"] = reps

    previous_reps = int(session.get("last_rep_count", 0))
    if reps > previous_reps:
        finalize_rep(session, reps)
    session["last_rep_count"] = reps

    if should_request_llm(session, posture_result):
        correction = llm_coach.realtime_correction(
            exercise_name=exercise.display_name,
            mistake_code=posture_result.get("mistake_code", "form_issue"),
            severity=int(posture_result.get("severity", 1)),
            reps=reps,
            stage=stage,
            tracked_angle=float(tracked_angle),
            local_message=correction,
        )
        session["last_llm_time"] = time.time()

    accuracy = 0
    if session["frames"] > 0:
        accuracy = round((session["good_frames"] / session["frames"]) * 100)
    common_mistake = ""
    if session["mistakes"]:
        common_mistake = max(session["mistakes"].items(), key=lambda item: item[1])[0]

    return {
        "exercise": exercise.name,
        "display_name": exercise.display_name,
        "confidence": 1.0,
        "reps": reps,
        "stage": stage,
        "correction": correction,
        "landmarks": (
            [{"x": lm[0], "y": lm[1], "z": lm[2], "visibility": lm[3]} for lm in landmarks]
            if payload.include_landmarks
            else []
        ),
        "tracked_angle": round(float(tracked_angle), 1),
        "tracked_angle_label": tracked_angle_meta(exercise)["label"],
        "tracked_angle_definition": tracked_angle_meta(exercise)["definition"],
        "accuracy": accuracy,
        "common_mistake": common_mistake,
        "ready": True,
    }


@app.post("/ai/session-report")
def session_report(payload: SessionReportSchema):
    exercise_key = normalize_exercise(payload.exercise)
    if exercise_key not in EXERCISE_CONFIGS:
        exercise_key = "bicep_curl"

    counter = session_counters.get(payload.session_id)
    reps = counter.counter if counter else 0
    return session_summary_payload(payload.session_id, exercise_key, reps)

# 7. Run server dynamically
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text
from database import Base
from datetime import datetime


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True)
    hashed_password = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)


class WorkoutDayProgress(Base):
    __tablename__ = "workout_day_progress"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    plan_id = Column(String(120), index=True, nullable=False)
    day_id = Column(String(120), index=True, nullable=False)
    day_name = Column(String(255), nullable=False)
    total_exercises = Column(Integer, default=0)
    completed_exercises = Column(Integer, default=0)
    status = Column(String(40), default="in_progress", index=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class WorkoutExerciseProgress(Base):
    __tablename__ = "workout_exercise_progress"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    plan_id = Column(String(120), index=True, nullable=False)
    day_id = Column(String(120), index=True, nullable=False)
    exercise_id = Column(String(120), index=True, nullable=False)
    exercise_name = Column(String(255), nullable=False)
    reps = Column(Integer, default=0)
    completed = Column(Boolean, default=False, index=True)
    completed_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class WorkoutExerciseStatus(Base):
    __tablename__ = "workout_exercise_status"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    plan_id = Column(String(120), index=True, nullable=False)
    day_id = Column(String(120), index=True, nullable=False)
    exercise_id = Column(String(120), index=True, nullable=False)
    exercise_name = Column(String(255), nullable=False)
    status = Column(String(40), default="in_progress", index=True)
    reps = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow)


class NutritionProfile(Base):
    __tablename__ = "nutrition_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, index=True, nullable=False)
    age = Column(Integer, nullable=True)
    sex = Column(String(20), default="unspecified")
    height_cm = Column(Float, nullable=True)
    weight_kg = Column(Float, nullable=True)
    activity_level = Column(String(40), default="moderate")
    goal_type = Column(String(40), default="maintain")
    target_calories = Column(Integer, default=2200)
    target_protein = Column(Integer, default=130)
    target_carbs = Column(Integer, default=220)
    target_fat = Column(Integer, default=70)
    updated_at = Column(DateTime, default=datetime.utcnow)


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    ingredients = Column(Text, default="")
    instructions = Column(Text, default="")
    meal_type = Column(String(40), default="lunch")
    calories = Column(Integer, default=0)
    protein = Column(Integer, default=0)
    carbs = Column(Integer, default=0)
    fat = Column(Integer, default=0)
    image_data = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class MealEntry(Base):
    __tablename__ = "meal_entries"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    date_key = Column(String(20), index=True, nullable=False)
    meal_type = Column(String(40), default="lunch")
    source = Column(String(40), default="manual")
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    calories = Column(Integer, default=0)
    protein = Column(Integer, default=0)
    carbs = Column(Integer, default=0)
    fat = Column(Integer, default=0)
    image_data = Column(Text, nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=True)
    consumed_at_label = Column(String(40), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

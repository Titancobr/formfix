import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Beef,
  Camera,
  Droplets,
  Flame,
  Pencil,
  Plus,
  Trash2,
  Wheat,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

type NutritionProfile = {
  user_id: number;
  age: number | null;
  sex: string;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: string;
  goal_type: string;
  target_calories: number;
  target_protein: number;
  target_carbs: number;
  target_fat: number;
};

type Recipe = {
  id: number;
  user_id: number;
  title: string;
  description: string;
  ingredients: string;
  instructions: string;
  meal_type: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  image_data?: string | null;
};

type Meal = {
  id: number;
  title: string;
  description: string;
  meal_type: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: string;
  image_data?: string | null;
  consumed_at_label?: string;
};

type DayData = {
  date_key: string;
  targets: {
    target_calories: number;
    target_protein: number;
    target_carbs: number;
    target_fat: number;
  };
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  remaining: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  meals: Record<string, Meal[]>;
  suggested_meal?: {
    title: string;
    description: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

const emptyRecipeForm = {
  title: "",
  description: "",
  ingredients: "",
  instructions: "",
  meal_type: "lunch",
  calories: 450,
  protein: 30,
  carbs: 45,
  fat: 15,
  image_data: "",
};

const Recipes = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fitUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("fitUser") || "null");
    } catch {
      return null;
    }
  }, []);
  const userId = fitUser?.user_id;

  const [profile, setProfile] = useState<NutritionProfile | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [dayData, setDayData] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);
  const [recipeForm, setRecipeForm] = useState(emptyRecipeForm);
  const [profileForm, setProfileForm] = useState({
    age: "",
    sex: "male",
    height_cm: "",
    weight_kg: "",
    activity_level: "moderate",
    goal_type: "maintain",
  });

  const loadAll = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [profileRes, recipesRes, dayRes] = await Promise.all([
        fetch(`${API_URL}/nutrition/profile/${userId}`),
        fetch(`${API_URL}/nutrition/recipes/${userId}`),
        fetch(`${API_URL}/nutrition/day/${userId}`),
      ]);
      const profileJson = await profileRes.json();
      const recipesJson = await recipesRes.json();
      const dayJson = await dayRes.json();
      setProfile(profileJson);
      setRecipes(recipesJson.recipes || []);
      setDayData(dayJson);
      setProfileForm({
        age: profileJson.age ? String(profileJson.age) : "",
        sex: profileJson.sex || "male",
        height_cm: profileJson.height_cm ? String(profileJson.height_cm) : "",
        weight_kg: profileJson.weight_kg ? String(profileJson.weight_kg) : "",
        activity_level: profileJson.activity_level || "moderate",
        goal_type: profileJson.goal_type || "maintain",
      });
    } catch {
      toast({ title: "Could not load meal data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) {
      navigate("/login");
      return;
    }
    loadAll();
  }, [userId]);

  const toBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleRecipeImage = async (file: File | null) => {
    if (!file) return;
    const image = await toBase64(file);
    setRecipeForm((current) => ({ ...current, image_data: image }));
  };

  const saveProfile = async () => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_URL}/nutrition/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          age: profileForm.age ? Number(profileForm.age) : null,
          sex: profileForm.sex,
          height_cm: profileForm.height_cm ? Number(profileForm.height_cm) : null,
          weight_kg: profileForm.weight_kg ? Number(profileForm.weight_kg) : null,
          activity_level: profileForm.activity_level,
          goal_type: profileForm.goal_type,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not save profile");
      toast({ title: "Meal goal updated" });
      await loadAll();
    } catch (error: any) {
      toast({ title: error.message || "Save failed", variant: "destructive" });
    }
  };

  const openCreate = () => {
    setEditingRecipeId(null);
    setRecipeForm(emptyRecipeForm);
    setDialogOpen(true);
  };

  const openEdit = (recipe: Recipe) => {
    setEditingRecipeId(recipe.id);
    setRecipeForm({
      title: recipe.title,
      description: recipe.description,
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
      meal_type: recipe.meal_type,
      calories: recipe.calories,
      protein: recipe.protein,
      carbs: recipe.carbs,
      fat: recipe.fat,
      image_data: recipe.image_data || "",
    });
    setDialogOpen(true);
  };

  const saveRecipe = async () => {
    if (!userId || !recipeForm.title.trim()) {
      toast({ title: "Recipe title is required", variant: "destructive" });
      return;
    }
    const payload = {
      user_id: userId,
      ...recipeForm,
      calories: Number(recipeForm.calories) || 0,
      protein: Number(recipeForm.protein) || 0,
      carbs: Number(recipeForm.carbs) || 0,
      fat: Number(recipeForm.fat) || 0,
    };

    const url = editingRecipeId
      ? `${API_URL}/nutrition/recipes/${editingRecipeId}`
      : `${API_URL}/nutrition/recipes`;
    const method = editingRecipeId ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not save recipe");
      toast({ title: editingRecipeId ? "Recipe updated" : "Recipe created" });
      setDialogOpen(false);
      setRecipeForm(emptyRecipeForm);
      await loadAll();
    } catch (error: any) {
      toast({ title: error.message || "Recipe save failed", variant: "destructive" });
    }
  };

  const removeRecipe = async (recipeId: number) => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_URL}/nutrition/recipes/${recipeId}?user_id=${userId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Delete failed");
      toast({ title: "Recipe deleted" });
      await loadAll();
    } catch (error: any) {
      toast({ title: error.message || "Delete failed", variant: "destructive" });
    }
  };

  const addRecipeToDay = async (recipe: Recipe) => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_URL}/nutrition/meals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          meal_type: recipe.meal_type,
          source: "recipe",
          title: recipe.title,
          description: recipe.description,
          calories: recipe.calories,
          protein: recipe.protein,
          carbs: recipe.carbs,
          fat: recipe.fat,
          image_data: recipe.image_data,
          recipe_id: recipe.id,
          consumed_at_label: "Planned meal",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not add meal");
      toast({ title: `${recipe.title} added to today` });
      await loadAll();
    } catch (error: any) {
      toast({ title: error.message || "Could not add meal", variant: "destructive" });
    }
  };

  const mealOrder = ["breakfast", "lunch", "dinner", "snack"];
  const caloriesPct = dayData
    ? Math.min((dayData.totals.calories / Math.max(dayData.targets.target_calories, 1)) * 100, 100)
    : 0;

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <div className="px-5 pt-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div>
            <h1 className="font-display text-3xl text-foreground">FITLIFE MEALS</h1>
            <p className="text-sm text-muted-foreground">Recipes, calorie goals, and today's meal plan.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/scan")} className="border-primary/30 text-primary">
            <Camera className="h-4 w-4 mr-2" />
            Scan Food
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="bg-primary text-primary-foreground">
                <Plus className="h-4 w-4 mr-2" />
                Recipe
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl text-foreground">
                  {editingRecipeId ? "EDIT RECIPE" : "CREATE RECIPE"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Title</Label>
                  <Input
                    value={recipeForm.title}
                    onChange={(e) => setRecipeForm((c) => ({ ...c, title: e.target.value }))}
                    className="mt-1 bg-secondary border-border"
                  />
                </div>
                <div>
                  <Label>Meal Type</Label>
                  <select
                    value={recipeForm.meal_type}
                    onChange={(e) => setRecipeForm((c) => ({ ...c, meal_type: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2 text-foreground"
                  >
                    {mealOrder.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label>Description</Label>
                  <Textarea
                    rows={2}
                    value={recipeForm.description}
                    onChange={(e) => setRecipeForm((c) => ({ ...c, description: e.target.value }))}
                    className="mt-1 bg-secondary border-border"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Ingredients</Label>
                  <Textarea
                    rows={3}
                    value={recipeForm.ingredients}
                    onChange={(e) => setRecipeForm((c) => ({ ...c, ingredients: e.target.value }))}
                    className="mt-1 bg-secondary border-border"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Instructions</Label>
                  <Textarea
                    rows={3}
                    value={recipeForm.instructions}
                    onChange={(e) => setRecipeForm((c) => ({ ...c, instructions: e.target.value }))}
                    className="mt-1 bg-secondary border-border"
                  />
                </div>
                <div>
                  <Label>Calories</Label>
                  <Input
                    type="number"
                    value={recipeForm.calories}
                    onChange={(e) => setRecipeForm((c) => ({ ...c, calories: Number(e.target.value) }))}
                    className="mt-1 bg-secondary border-border"
                  />
                </div>
                <div>
                  <Label>Protein (g)</Label>
                  <Input
                    type="number"
                    value={recipeForm.protein}
                    onChange={(e) => setRecipeForm((c) => ({ ...c, protein: Number(e.target.value) }))}
                    className="mt-1 bg-secondary border-border"
                  />
                </div>
                <div>
                  <Label>Carbs (g)</Label>
                  <Input
                    type="number"
                    value={recipeForm.carbs}
                    onChange={(e) => setRecipeForm((c) => ({ ...c, carbs: Number(e.target.value) }))}
                    className="mt-1 bg-secondary border-border"
                  />
                </div>
                <div>
                  <Label>Fat (g)</Label>
                  <Input
                    type="number"
                    value={recipeForm.fat}
                    onChange={(e) => setRecipeForm((c) => ({ ...c, fat: Number(e.target.value) }))}
                    className="mt-1 bg-secondary border-border"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Recipe Picture</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleRecipeImage(e.target.files?.[0] || null)}
                    className="mt-1 bg-secondary border-border"
                  />
                  {recipeForm.image_data ? (
                    <img src={recipeForm.image_data} alt="Recipe preview" className="mt-3 h-28 w-full rounded-xl object-cover" />
                  ) : null}
                </div>
                <div className="md:col-span-2">
                  <Button onClick={saveRecipe} className="w-full bg-primary text-primary-foreground">
                    {editingRecipeId ? "Save Recipe" : "Create Recipe"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="px-5 space-y-5">
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-black/10 to-black/30 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">Daily target</p>
                <h2 className="mt-1 font-display text-4xl text-foreground">
                  {dayData?.targets.target_calories || 2200}
                  <span className="ml-2 text-lg text-muted-foreground">cal</span>
                </h2>
                <p className="mt-2 max-w-xl text-sm text-white/80">
                  Goal-aware plan for {profile?.goal_type?.replace(/_/g, " ") || "maintain"} with macros tuned from your profile.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
                <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-muted-foreground">Remaining</p>
                <p className="font-display text-3xl text-primary">{dayData?.remaining.calories || 0}</p>
                <p className="text-xs text-muted-foreground">calories left today</p>
              </div>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-primary"
                animate={{ width: `${caloriesPct}%` }}
                transition={{ duration: 0.45 }}
              />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {[
                { label: "Calories", value: dayData?.totals.calories || 0, suffix: "cal", icon: Flame, tone: "text-orange-400" },
                { label: "Protein", value: dayData?.totals.protein || 0, suffix: "g", icon: Beef, tone: "text-red-400" },
                { label: "Carbs", value: dayData?.totals.carbs || 0, suffix: "g", icon: Wheat, tone: "text-yellow-400" },
                { label: "Fat", value: dayData?.totals.fat || 0, suffix: "g", icon: Droplets, tone: "text-blue-400" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <item.icon className={`h-4 w-4 ${item.tone}`} />
                  <p className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">{item.label}</p>
                  <p className="font-heading text-xl text-foreground">
                    {item.value}
                    <span className="ml-1 text-sm text-muted-foreground">{item.suffix}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-card/80 p-5 backdrop-blur-xl">
            <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">Body goals</p>
            <h3 className="mt-1 font-display text-2xl text-foreground">Set your calorie target</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Input placeholder="Age" value={profileForm.age} onChange={(e) => setProfileForm((c) => ({ ...c, age: e.target.value }))} className="bg-secondary border-border" />
              <Input placeholder="Weight (kg)" value={profileForm.weight_kg} onChange={(e) => setProfileForm((c) => ({ ...c, weight_kg: e.target.value }))} className="bg-secondary border-border" />
              <Input placeholder="Height (cm)" value={profileForm.height_cm} onChange={(e) => setProfileForm((c) => ({ ...c, height_cm: e.target.value }))} className="bg-secondary border-border" />
              <select value={profileForm.sex} onChange={(e) => setProfileForm((c) => ({ ...c, sex: e.target.value }))} className="rounded-md border border-border bg-secondary px-3 py-2 text-foreground">
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="unspecified">Prefer not to say</option>
              </select>
              <select value={profileForm.activity_level} onChange={(e) => setProfileForm((c) => ({ ...c, activity_level: e.target.value }))} className="rounded-md border border-border bg-secondary px-3 py-2 text-foreground">
                <option value="sedentary">Sedentary</option>
                <option value="light">Light activity</option>
                <option value="moderate">Moderate</option>
                <option value="active">Active</option>
                <option value="very_active">Very active</option>
              </select>
              <select value={profileForm.goal_type} onChange={(e) => setProfileForm((c) => ({ ...c, goal_type: e.target.value }))} className="rounded-md border border-border bg-secondary px-3 py-2 text-foreground">
                <option value="maintain">Maintain weight</option>
                <option value="weight_loss">Weight loss</option>
                <option value="weight_gain">Weight gain</option>
                <option value="build_muscle">Build muscle</option>
              </select>
            </div>
            <Button onClick={saveProfile} className="mt-4 w-full bg-primary text-primary-foreground">
              Save meal goal
            </Button>
          </div>
        </section>

        <section className="rounded-3xl border border-primary/20 bg-primary/8 p-5">
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">AI meal section</p>
          <h3 className="mt-1 font-display text-2xl text-foreground">
            {dayData?.suggested_meal?.title || "Suggested meal for today"}
          </h3>
          <p className="mt-2 text-sm text-white/80">
            {dayData?.suggested_meal?.description || "Save your goal above to get a better calorie-aware meal recommendation."}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              { label: "Calories", value: dayData?.suggested_meal?.calories || 0 },
              { label: "Protein", value: dayData?.suggested_meal?.protein || 0 },
              { label: "Carbs", value: dayData?.suggested_meal?.carbs || 0 },
              { label: "Fat", value: dayData?.suggested_meal?.fat || 0 },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">{item.label}</p>
                <p className="font-heading text-xl text-foreground">
                  {item.value}
                  <span className="ml-1 text-sm text-muted-foreground">{item.label === "Calories" ? "cal" : "g"}</span>
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-card/80 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">Today's meals</p>
              <h3 className="mt-1 font-display text-2xl text-foreground">What to eat today</h3>
            </div>
            {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {mealOrder.map((mealType) => (
              <div key={mealType} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <h4 className="font-heading text-lg uppercase text-foreground">{mealType}</h4>
                <div className="mt-3 space-y-2">
                  {(dayData?.meals?.[mealType] || []).length ? (
                    (dayData?.meals?.[mealType] || []).map((meal) => (
                      <div key={meal.id} className="rounded-xl border border-white/10 bg-black/15 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-foreground">{meal.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {meal.consumed_at_label || "Added today"} • {meal.source}
                            </p>
                          </div>
                          <span className="text-sm font-semibold text-primary">{meal.calories} cal</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No {mealType} logged yet.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">Recipe library</p>
              <h3 className="mt-1 font-display text-2xl text-foreground">Save meals with picture and macros</h3>
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {recipes.map((recipe, index) => (
              <motion.div
                key={recipe.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="overflow-hidden rounded-3xl border border-white/10 bg-card/80 shadow-[0_18px_60px_rgba(0,0,0,0.18)]"
              >
                {recipe.image_data ? (
                  <img src={recipe.image_data} alt={recipe.title} className="h-40 w-full object-cover" />
                ) : (
                  <div className="h-40 w-full bg-gradient-to-br from-primary/20 via-secondary to-black/30" />
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-primary/70">{recipe.meal_type}</p>
                      <h4 className="mt-1 font-heading text-xl text-foreground">{recipe.title}</h4>
                    </div>
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      {recipe.calories} cal
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{recipe.description}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-2xl border border-white/10 bg-black/10 p-2">
                      <p className="text-xs text-muted-foreground">Protein</p>
                      <p className="font-semibold text-foreground">{recipe.protein}g</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/10 p-2">
                      <p className="text-xs text-muted-foreground">Carbs</p>
                      <p className="font-semibold text-foreground">{recipe.carbs}g</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/10 p-2">
                      <p className="text-xs text-muted-foreground">Fat</p>
                      <p className="font-semibold text-foreground">{recipe.fat}g</p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button onClick={() => addRecipeToDay(recipe)} className="flex-1 bg-primary text-primary-foreground">
                      Add to today
                    </Button>
                    <Button variant="outline" onClick={() => openEdit(recipe)} className="border-white/15">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" onClick={() => removeRecipe(recipe.id)} className="border-destructive/30 text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      </div>

      <BottomNav />
    </div>
  );
};

export default Recipes;

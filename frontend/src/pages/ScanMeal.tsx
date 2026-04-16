import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Camera, Plus, ScanLine, Sparkles, Trash2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

type ScanEstimate = {
  title: string;
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type Meal = {
  id: number;
  title: string;
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: string;
  meal_type: string;
  consumed_at_label?: string;
  image_data?: string | null;
};

const ScanMeal = () => {
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

  const [mealHint, setMealHint] = useState("");
  const [mealType, setMealType] = useState("lunch");
  const [consumedAtLabel, setConsumedAtLabel] = useState("");
  const [imageData, setImageData] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [estimate, setEstimate] = useState<ScanEstimate | null>(null);
  const [todayMeals, setTodayMeals] = useState<Meal[]>([]);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualCalories, setManualCalories] = useState("350");
  const [manualProtein, setManualProtein] = useState("20");
  const [manualCarbs, setManualCarbs] = useState("35");
  const [manualFat, setManualFat] = useState("12");

  const mealOrder = ["breakfast", "lunch", "dinner", "snack"];

  const loadTodayMeals = async () => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_URL}/nutrition/day/${userId}`);
      const data = await response.json();
      const merged = Object.values(data.meals || {}).flat() as Meal[];
      setTodayMeals(merged);
    } catch {
      toast({ title: "Could not load today's meals", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (!userId) {
      navigate("/login");
      return;
    }
    loadTodayMeals();
  }, [userId]);

  const toBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const onFilePicked = async (file: File | null) => {
    if (!file) return;
    const image = await toBase64(file);
    setImageData(image);
  };

  const scanMeal = async () => {
    if (!userId || !imageData) {
      toast({ title: "Upload a meal photo first", variant: "destructive" });
      return;
    }
    setIsScanning(true);
    try {
      const response = await fetch(`${API_URL}/nutrition/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          image: imageData,
          meal_hint: mealHint,
          meal_type: mealType,
          add_to_day: true,
          consumed_at_label: consumedAtLabel,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Scan failed");
      setEstimate(data.estimate);
      toast({ title: `${data.estimate.title} added to today's meals` });
      await loadTodayMeals();
    } catch (error: any) {
      toast({ title: error.message || "Could not scan meal", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  };

  const addManualMeal = async () => {
    if (!userId || !manualTitle.trim()) {
      toast({ title: "Meal title is required", variant: "destructive" });
      return;
    }
    try {
      const response = await fetch(`${API_URL}/nutrition/meals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          meal_type: mealType,
          source: "manual",
          title: manualTitle,
          description: manualDescription,
          calories: Number(manualCalories) || 0,
          protein: Number(manualProtein) || 0,
          carbs: Number(manualCarbs) || 0,
          fat: Number(manualFat) || 0,
          consumed_at_label: consumedAtLabel,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not add meal");
      toast({ title: "Manual meal added to today" });
      setManualTitle("");
      setManualDescription("");
      await loadTodayMeals();
    } catch (error: any) {
      toast({ title: error.message || "Could not add meal", variant: "destructive" });
    }
  };

  const deleteMeal = async (mealId: number) => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_URL}/nutrition/meals/${mealId}?user_id=${userId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not delete meal");
      toast({ title: "Meal removed" });
      await loadTodayMeals();
    } catch (error: any) {
      toast({ title: error.message || "Could not delete meal", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <div className="px-5 pt-6 pb-4 flex items-center gap-3">
        <button onClick={() => navigate("/recipes")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div>
          <h1 className="font-display text-3xl text-foreground">SCAN FOOD</h1>
          <p className="text-sm text-muted-foreground">Upload a meal photo or add another food manually.</p>
        </div>
      </div>

      <div className="px-5 space-y-5">
        <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-black/10 to-black/25 p-5">
            <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">Vision calories</p>
            <h2 className="mt-1 font-display text-3xl text-foreground">Scan what you're eating</h2>
            <p className="mt-2 text-sm text-white/80">
              Upload a picture of your food. The LLM estimates calories and macros, then adds it to today's meal log.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Food Photo</Label>
                <Input type="file" accept="image/*" onChange={(e) => onFilePicked(e.target.files?.[0] || null)} className="mt-1 bg-secondary border-border" />
              </div>
              <div>
                <Label>Meal Type</Label>
                <select value={mealType} onChange={(e) => setMealType(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2 text-foreground">
                  {mealOrder.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Time label</Label>
                <Input value={consumedAtLabel} onChange={(e) => setConsumedAtLabel(e.target.value)} placeholder="8:00 PM" className="mt-1 bg-secondary border-border" />
              </div>
              <div className="md:col-span-2">
                <Label>Food hint (optional)</Label>
                <Textarea
                  rows={2}
                  value={mealHint}
                  onChange={(e) => setMealHint(e.target.value)}
                  placeholder="Example: paneer wrap, biryani, grilled fish with rice"
                  className="mt-1 bg-secondary border-border"
                />
              </div>
            </div>

            {imageData ? (
              <img src={imageData} alt="Meal preview" className="mt-4 h-56 w-full rounded-2xl object-cover" />
            ) : null}

            <Button onClick={scanMeal} disabled={isScanning} className="mt-4 w-full bg-primary text-primary-foreground">
              <Camera className="h-4 w-4 mr-2" />
              {isScanning ? "Scanning calories..." : "Scan and add to today"}
            </Button>
          </div>

          <div className="rounded-3xl border border-white/10 bg-card/80 p-5">
            <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">Scan result</p>
            {estimate ? (
              <div className="mt-3 space-y-4">
                <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-primary/15 p-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-heading text-2xl text-foreground">{estimate.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{estimate.description}</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Calories", value: estimate.calories, suffix: "cal" },
                    { label: "Protein", value: estimate.protein, suffix: "g" },
                    { label: "Carbs", value: estimate.carbs, suffix: "g" },
                    { label: "Fat", value: estimate.fat, suffix: "g" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-white/10 bg-black/10 p-3">
                      <p className="text-xs uppercase tracking-widest text-muted-foreground">{item.label}</p>
                      <p className="font-heading text-xl text-foreground">
                        {item.value}
                        <span className="ml-1 text-sm text-muted-foreground">{item.suffix}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/10 p-6 text-center">
                <ScanLine className="mx-auto h-8 w-8 text-primary/70" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Upload a food photo to get a calorie estimate and add it directly to your daily meal section.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/10 bg-card/80 p-5">
            <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">Eating something else?</p>
            <h3 className="mt-1 font-display text-2xl text-foreground">Add another food manually</h3>
            <div className="mt-4 grid gap-3">
              <Input value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="Meal name" className="bg-secondary border-border" />
              <Textarea value={manualDescription} onChange={(e) => setManualDescription(e.target.value)} placeholder="Short description" className="bg-secondary border-border" rows={2} />
              <div className="grid grid-cols-2 gap-3">
                <Input type="number" value={manualCalories} onChange={(e) => setManualCalories(e.target.value)} placeholder="Calories" className="bg-secondary border-border" />
                <Input type="number" value={manualProtein} onChange={(e) => setManualProtein(e.target.value)} placeholder="Protein" className="bg-secondary border-border" />
                <Input type="number" value={manualCarbs} onChange={(e) => setManualCarbs(e.target.value)} placeholder="Carbs" className="bg-secondary border-border" />
                <Input type="number" value={manualFat} onChange={(e) => setManualFat(e.target.value)} placeholder="Fat" className="bg-secondary border-border" />
              </div>
              <Button onClick={addManualMeal} className="bg-primary text-primary-foreground">
                <Plus className="h-4 w-4 mr-2" />
                Add meal to today
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-card/80 p-5">
            <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">Today's log</p>
            <h3 className="mt-1 font-display text-2xl text-foreground">Meals already added</h3>
            <div className="mt-4 space-y-3">
              {todayMeals.length ? (
                todayMeals.map((meal) => (
                  <motion.div
                    key={meal.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-white/10 bg-black/10 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{meal.title}</p>
                        <p className="text-xs uppercase tracking-widest text-primary/70">
                          {meal.meal_type} • {meal.source}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{meal.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                          {meal.calories} cal
                        </span>
                        <Button variant="outline" onClick={() => deleteMeal(meal.id)} className="border-destructive/30 text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No meals added yet today.</p>
              )}
            </div>
          </div>
        </section>
      </div>

      <BottomNav />
    </div>
  );
};

export default ScanMeal;

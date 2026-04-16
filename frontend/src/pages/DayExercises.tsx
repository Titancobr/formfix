// src/pages/DayExercises.tsx
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Target, 
  Info, 
  Camera,
  Sparkles,
  X,
} from "lucide-react";
import { pushPullLegPlan, highVolumeSplitPlan } from "@/data/workoutData";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import { useToast } from "@/hooks/use-toast";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

type ExerciseReport = {
  exercise: string;
  reps: number;
  accuracy: number;
  perfect_reps: number;
  corrected_reps: number;
  common_mistakes: string[];
  what_went_right: string[];
  what_went_wrong: string[];
  rep_breakdown: Array<{
    rep_number: number;
    quality_score: number;
    verdict: string;
    main_issue: string;
  }>;
  report: {
    summary: string;
    what_went_well: string;
    improve_next: string;
    coach_tip: string;
  };
};

const DayExercises = () => {
  const { planId, dayId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const [completedExercises, setCompletedExercises] = useState<string[]>([]);
  const [skippedExercises, setSkippedExercises] = useState<string[]>([]);
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);
  const [latestReport, setLatestReport] = useState<ExerciseReport | null>(null);

  // Match plan data based on ID
  const plan = planId === "ppl" ? pushPullLegPlan : highVolumeSplitPlan;
  const day = plan?.days.find((d) => d.id === dayId);

  useEffect(() => {
    const completedExerciseId = searchParams.get("completed");
    const skippedExerciseId = searchParams.get("skipped");
    if (!completedExerciseId && !skippedExerciseId) return;

    if (completedExerciseId) {
      setCompletedExercises((prev) =>
        prev.includes(completedExerciseId) ? prev : [...prev, completedExerciseId]
      );
      try {
        const stored = localStorage.getItem("lastExerciseReport");
        if (stored) {
          setLatestReport(JSON.parse(stored));
        }
      } catch {
        // Ignore malformed local report data.
      }
      toast({
        title: "EXERCISE STRUCK",
        description: "8+ clean reps logged through Green FormFix Lens.",
      });
    }
    if (skippedExerciseId) {
      setSkippedExercises((prev) =>
        prev.includes(skippedExerciseId) ? prev : [...prev, skippedExerciseId]
      );
      toast({
        title: "EXERCISE SKIPPED",
        description: "No problem. This movement stays pending for your next session.",
      });
    }
    setSearchParams({});
  }, [searchParams, setSearchParams, toast]);

  useEffect(() => {
    const fitUserRaw = localStorage.getItem("fitUser");
    if (!fitUserRaw || !planId || !dayId) return;
    let fitUser: { user_id?: number } = {};
    try {
      fitUser = JSON.parse(fitUserRaw);
    } catch {
      return;
    }
    if (!fitUser.user_id) return;

    fetch(`${API_URL}/progress/day/${fitUser.user_id}/${planId}/${dayId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setCompletedExercises(data.completed || []);
        setSkippedExercises(data.skipped || []);
      })
      .catch(() => {
        // Ignore fetch issues and let local flow continue.
      });
  }, [planId, dayId]);

  if (!day) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Workout day not found</p>
      </div>
    );
  }

  const toggleComplete = (exerciseId: string) => {
    setCompletedExercises((prev) =>
      prev.includes(exerciseId) ? prev.filter((id) => id !== exerciseId) : [...prev, exerciseId]
    );
  };

  const progress = (completedExercises.length / day.exercises.length) * 100;
  const remainingExercises = day.exercises.filter(
    (exercise) => !completedExercises.includes(exercise.id)
  ).length;

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="px-5 pt-6 pb-2 flex items-center gap-3">
        <button 
          onClick={() => navigate(`/workout/${planId}`)} 
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="flex-1">
          <h1 className="font-heading text-3xl text-foreground uppercase tracking-tight">
            {day.name}
          </h1>
          <p className="text-primary text-[10px] font-mono uppercase tracking-widest">
            {day.focus}
          </p>
        </div>
        
        {/* Main AR Lens Trigger */}
        <Button 
          variant="outline" 
          size="sm"
          className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary hover:text-black transition-all"
          onClick={() => navigate(`/camera?plan=${planId}&day=${dayId}`)}
        >
          <Camera className="h-4 w-4" />
          <span className="font-mono text-[10px] font-bold">LENS</span>
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="px-5 my-6">
        <div className="flex items-center justify-between text-[10px] font-mono mb-2 uppercase tracking-tighter">
          <span className="text-muted-foreground">Completion Status</span>
          <span className="text-primary">{completedExercises.length}/{day.exercises.length} Exercises</span>
        </div>
        <div className="h-1.5 bg-secondary/50 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: "circOut" }}
          />
        </div>
      </div>

      <AnimatePresence>
        {latestReport && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="px-5 mb-6"
          >
            <div className="glass-card border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary">
                    Latest Lens Report
                  </p>
                  <h3 className="mt-1 font-heading text-2xl uppercase">
                    {latestReport.exercise.replace(/_/g, " ")}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {latestReport.report?.summary}
                  </p>
                </div>
                <button
                  onClick={() => setLatestReport(null)}
                  className="rounded-full border border-white/10 p-2 text-muted-foreground hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Total Reps</p>
                  <p className="mt-1 font-heading text-3xl text-primary">{latestReport.reps}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Perfect Reps</p>
                  <p className="mt-1 font-heading text-3xl text-primary">{latestReport.perfect_reps}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Needs Work</p>
                  <p className="mt-1 font-heading text-3xl text-amber-300">{latestReport.corrected_reps}</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-secondary/20 p-4">
                  <p className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    What You Did Right
                  </p>
                  <ul className="mt-3 space-y-2">
                    {latestReport.what_went_right?.map((item, index) => (
                      <li key={index} className="text-sm text-muted-foreground leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-white/10 bg-secondary/20 p-4">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-amber-300">
                    What To Improve
                  </p>
                  <ul className="mt-3 space-y-2">
                    {latestReport.what_went_wrong?.map((item, index) => (
                      <li key={index} className="text-sm text-muted-foreground leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-primary/15 bg-primary/10 p-4">
                <p className="text-[10px] font-mono uppercase tracking-widest text-primary">Coach Notes</p>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {latestReport.report?.what_went_well}
                </p>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {latestReport.report?.improve_next}
                </p>
                <p className="mt-2 text-sm text-white/85 leading-relaxed">
                  {latestReport.report?.coach_tip}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Exercises List */}
      <div className="px-5 space-y-4">
        {day.exercises.map((exercise, i) => {
          const isCompleted = completedExercises.includes(exercise.id);
          const isSkipped = skippedExercises.includes(exercise.id) && !isCompleted;
          const isExpanded = expandedExercise === exercise.id;

          return (
            <motion.div
              key={exercise.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`glass-card overflow-hidden transition-all duration-300 ${
                isCompleted ? "border-primary/20 bg-primary/5" : "border-white/5"
              } ${
                isSkipped ? "border-amber-300/25 bg-amber-200/5" : ""
              }`}
            >
              <div
                className="p-4 flex items-center gap-4 cursor-pointer"
                onClick={() => setExpandedExercise(isExpanded ? null : exercise.id)}
              >
                {/* Completion Toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleComplete(exercise.id);
                  }}
                  className={`flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                    isCompleted
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/30 hover:border-primary"
                  }`}
                >
                  {isCompleted && <Check className="h-3.5 w-3.5 text-black font-bold" />}
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className={`font-heading text-lg leading-tight uppercase ${isCompleted ? "line-through opacity-40" : ""}`}>
                    {exercise.name}
                  </h3>
                  <p className="text-muted-foreground text-[10px] font-mono uppercase tracking-tighter mt-1">
                    {exercise.sets} Sets · {exercise.reps} Reps · {exercise.muscle}
                  </p>
                  {isSkipped && (
                    <p className="text-amber-300 text-[10px] font-mono uppercase tracking-widest mt-1">
                      Skipped (Pending)
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                   {/* Specific Exercise Camera Trigger */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/camera?plan=${planId}&day=${dayId}&ex=${exercise.id}`);
                    }}
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                  
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                  >
                    <div className="px-4 pb-5 space-y-4 border-t border-white/5 pt-4">
                      <div className="flex items-start gap-3">
                        <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {exercise.description}
                        </p>
                      </div>

                      <div className="bg-secondary/20 p-3 rounded-lg">
                        <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2 flex items-center gap-1">
                          <Target className="h-3 w-3" /> Technical Execution
                        </p>
                        <ul className="space-y-1.5">
                          {exercise.tips.map((tip, j) => (
                            <li key={j} className="text-[11px] text-muted-foreground flex items-center gap-2">
                              <span className="w-1 h-1 bg-primary rounded-full" />
                              {tip}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      <div className="px-5 mt-5">
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Pending Exercises
          </p>
          <p className="font-heading text-xl mt-1">{remainingExercises}</p>
        </div>
      </div>

      {/* Complete Workout Button */}
      {completedExercises.length === day.exercises.length && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-24 left-0 right-0 px-5 z-40"
        >
          <Button
            onClick={() => {
              toast({ 
                title: "WORKOUT COMPLETE", 
                description: "Hypertrophy session logged successfully. ⚡" 
              });
              navigate(`/workout/${planId}`);
            }}
            className="w-full h-14 bg-primary text-black font-heading text-xl tracking-widest shadow-[0_0_20px_rgba(234,179,8,0.3)]"
          >
            END SESSION
          </Button>
        </motion.div>
      )}

      <BottomNav />
    </div>
  );
};

export default DayExercises;

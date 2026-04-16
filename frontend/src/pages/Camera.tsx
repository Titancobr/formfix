// src/pages/Camera.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mic2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCamera } from "@/hooks/useCamera";
import { pushPullLegPlan, highVolumeSplitPlan } from "@/data/workoutData";
import { Button } from "@/components/ui/button";

type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility: number;
};

type AiResult = {
  exercise: string;
  display_name: string;
  confidence: number;
  reps: number;
  stage: string;
  correction: string;
  landmarks: Landmark[];
  tracked_angle: number;
  tracked_angle_label?: string;
  tracked_angle_definition?: string;
  common_mistake: string;
  ready: boolean;
};

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const POSE_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [28, 30],
  [30, 32],
];

const normalizeExercise = (name: string) =>
  name
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const Camera = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { videoRef, isActive, error } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const requestInFlight = useRef(false);
  const lastSpokenRef = useRef("");
  const lastSpokenAtRef = useRef(0);
  const milestonesSpokenRef = useRef<Set<number>>(new Set());

  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);

  const planId = searchParams.get("plan") || "ppl";
  const dayId = searchParams.get("day") || "";
  const exerciseId = searchParams.get("ex") || "";

  const plan = planId === "ppl" ? pushPullLegPlan : highVolumeSplitPlan;
  const day = plan?.days.find((d) => d.id === dayId);
  const selectedExercise =
    day?.exercises.find((exercise) => exercise.id === exerciseId) || day?.exercises[0];

  const sessionId = useMemo(
    () => `${planId}-${dayId}-${selectedExercise?.id || "free-lens"}`,
    [planId, dayId, selectedExercise?.id],
  );

  const targetExerciseName = selectedExercise?.name || "Bicep Curl";
  const reps = aiResult?.reps || 0;
  const canFinish = reps >= 8;
  const fitUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("fitUser") || "null");
    } catch {
      return null;
    }
  })();

  const speak = (text: string) => {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    if (!text || text === "Good form" || text === lastSpokenRef.current) return;
    const now = Date.now();
    if (now - lastSpokenAtRef.current < 2200) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 0.95;
    window.speechSynthesis.speak(utterance);
    lastSpokenRef.current = text;
    lastSpokenAtRef.current = now;
  };

  const drawSkeleton = (landmarks: Landmark[]) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || canvas.clientWidth;
    canvas.height = video.videoHeight || canvas.clientHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(14, 165, 233, 0.95)";
    ctx.shadowColor = "rgba(14, 165, 233, 0.8)";
    ctx.shadowBlur = 16;

    POSE_CONNECTIONS.forEach(([start, end]) => {
      const a = landmarks[start];
      const b = landmarks[end];
      if (!a || !b || a.visibility < 0.35 || b.visibility < 0.35) return;
      ctx.beginPath();
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      ctx.stroke();
    });

    ctx.shadowBlur = 10;
    landmarks.forEach((landmark) => {
      if (landmark.visibility < 0.4) return;
      ctx.beginPath();
      ctx.fillStyle = "rgba(251, 146, 60, 0.95)";
      ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const analyzeFrame = async (reset = false) => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || !isActive || requestInFlight.current) return;
    if (!video.videoWidth || !video.videoHeight) return;

    requestInFlight.current = true;
    setIsAnalyzing(true);

    canvas.width = 384;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 384);
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.62);

    try {
      const response = await fetch(`${API_URL}/ai/analyze-frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          exercise: targetExerciseName,
          session_id: sessionId,
          reset,
          include_landmarks: showSkeleton,
        }),
      });

      if (!response.ok) throw new Error("AI analysis failed");
      const data = (await response.json()) as AiResult;
      setAiResult(data);
      if (showSkeleton) {
        drawSkeleton(data.landmarks || []);
      } else {
        const overlayCtx = canvasRef.current?.getContext("2d");
        if (overlayCtx && canvasRef.current) {
          overlayCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }

      if (data.correction) speak(data.correction);

      [8, 12, 15].forEach((milestone) => {
        if (data.reps >= milestone && !milestonesSpokenRef.current.has(milestone)) {
          milestonesSpokenRef.current.add(milestone);
          speak(`${milestone} reps done. Keep going strong.`);
        }
      });
    } catch (err) {
      setAiResult((current) => ({
        exercise: current?.exercise || "offline",
        display_name: current?.display_name || targetExerciseName,
        confidence: 0,
        reps: current?.reps || 0,
        stage: current?.stage || "ready",
        correction: "AI backend is not connected. Start the FastAPI server.",
        landmarks: [],
        tracked_angle: 0,
        common_mistake: "",
        tracked_angle_label: "Tracked angle",
        tracked_angle_definition: "exercise-specific joints",
        ready: false,
      }));
    } finally {
      setIsAnalyzing(false);
      requestInFlight.current = false;
    }
  };

  useEffect(() => {
    if (!isActive) return;
    analyzeFrame(true);
    const interval = window.setInterval(() => analyzeFrame(false), 320);
    return () => window.clearInterval(interval);
  }, [isActive, sessionId, targetExerciseName, showSkeleton]);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!day || !selectedExercise) {
    return <div className="p-10 text-center">Workout not found.</div>;
  }

  const saveProgress = async (status: "completed" | "skipped") => {
    const totalExercises = day?.exercises.length || 0;
    if (fitUser?.user_id) {
      try {
        await fetch(`${API_URL}/progress/exercise`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: fitUser.user_id,
            plan_id: planId,
            day_id: dayId,
            day_name: day?.name || "Workout Day",
            exercise_id: selectedExercise.id,
            exercise_name: selectedExercise.name,
            reps,
            completed: status === "completed",
            status,
            total_exercises: totalExercises,
          }),
        });
      } catch {
        // UI still continues even if progress sync fails.
      }
    }
  };

  const saveExerciseReport = async () => {
    try {
      const response = await fetch(`${API_URL}/ai/session-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          exercise: targetExerciseName,
        }),
      });
      if (!response.ok) return;
      const data = await response.json();
      localStorage.setItem("lastExerciseReport", JSON.stringify(data));
    } catch {
      // Report is optional; workout flow should continue.
    }
  };

  const finishWorkout = async () => {
    await saveExerciseReport();
    await saveProgress("completed");
    navigate(`/workout/${planId}/${dayId}?completed=${selectedExercise.id}`);
  };

  const cancelWorkout = async () => {
    await saveExerciseReport();
    await saveProgress("skipped");
    navigate(`/workout/${planId}/${dayId}?skipped=${selectedExercise.id}`);
  };

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(14,165,233,0.28),transparent_38%),linear-gradient(180deg,rgba(0,0,0,0.25),rgba(0,0,0,0.92))] z-10 pointer-events-none" />

      <div className="absolute top-0 w-full z-30 p-5 flex items-center justify-between bg-gradient-to-b from-black/85 to-transparent">
        <button onClick={() => navigate(-1)} className="p-3 rounded-full bg-white/10 backdrop-blur-md">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-[10px] font-mono text-primary uppercase tracking-[0.35em]">
            Green FormFix Lens
          </p>
          <h2 className="font-heading text-2xl uppercase leading-none">{targetExerciseName}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSkeleton((value) => !value)}
            className={`p-3 rounded-full backdrop-blur-md ${
              showSkeleton ? "bg-sky-500/90 text-white" : "bg-white/10 text-white"
            }`}
            title="Toggle skeleton overlay"
          >
            {showSkeleton ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
          </button>
          <button
            onClick={() => setVoiceEnabled((value) => !value)}
            className={`p-3 rounded-full backdrop-blur-md ${
              voiceEnabled ? "bg-primary text-black" : "bg-white/10 text-white"
            }`}
          >
            <Mic2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
        {!isActive && (
          <div className="flex flex-col items-center gap-2 z-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-xs font-mono opacity-60 uppercase">
              {error || "Initializing AI Lens..."}
            </p>
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-500 ${
            isActive ? "opacity-100" : "opacity-0"
          }`}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover scale-x-[-1] z-20 pointer-events-none"
        />
        <canvas ref={captureCanvasRef} className="hidden" />
      </div>

      <div className="absolute top-24 right-5 z-30 flex gap-2 pointer-events-none">
        {[8, 12, 15].map((milestone) => (
          <div
            key={milestone}
            className={`min-w-[62px] rounded-full border px-3 py-2 backdrop-blur-md ${
              reps >= milestone
                ? "border-primary bg-primary/20 text-primary"
                : "border-white/10 bg-black/20 text-white/45"
            }`}
          >
            <p className="font-heading text-base leading-none text-center">{milestone}</p>
            <p className="text-[8px] font-mono uppercase tracking-widest text-center">Reps</p>
          </div>
        ))}
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-30 p-4 pb-6 bg-gradient-to-t from-black/65 via-black/20 to-transparent">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_340px]">
            <div className="rounded-3xl border border-white/10 bg-black/20 px-4 py-3 backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-mono text-primary uppercase tracking-[0.28em]">
                    Live Coaching
                  </p>
                  <h3 className="mt-1 text-xl font-heading uppercase leading-none">
                    {aiResult?.display_name || targetExerciseName}
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                      <p className="text-[9px] font-mono uppercase text-muted-foreground">Stage</p>
                      <p className="font-heading text-sm uppercase">{aiResult?.stage || "Ready"}</p>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                      <p className="text-[9px] font-mono uppercase text-muted-foreground">
                        {aiResult?.tracked_angle_label || "Tracked angle"}
                      </p>
                      <p className="font-heading text-sm">{aiResult?.tracked_angle || 0}°</p>
                      <p className="text-[8px] font-mono uppercase tracking-[0.18em] text-white/45">
                        {aiResult?.tracked_angle_definition || "exercise-specific joints"}
                      </p>
                    </div>
                    <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5">
                      <p className="text-[9px] font-mono uppercase text-primary/80">Coach</p>
                      <p className="font-heading text-sm text-primary">{isAnalyzing ? "Live" : "Ready"}</p>
                    </div>
                  </div>
                </div>
                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={reps}
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 1.2, opacity: 0 }}
                    className="rounded-3xl border border-primary/20 bg-primary/10 px-4 py-3 text-right"
                  >
                    <p className="text-4xl font-heading text-primary leading-none">{reps}</p>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      Reps Done
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="mt-3 rounded-2xl border border-primary/20 bg-black/20 px-4 py-3">
                <div className="flex gap-3 items-start">
                  <div className="mt-0.5 rounded-full bg-primary/15 p-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/80">
                      Coach Cue
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-white/92">
                      {aiResult?.correction || "Get ready. I will count clean reps and guide your form."}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/20 p-3 backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-11 rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10"
                  onClick={cancelWorkout}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                {canFinish ? (
                  <Button
                    className="h-11 rounded-2xl bg-primary text-black font-heading text-base tracking-wide hover:bg-primary/90"
                    onClick={finishWorkout}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Finish
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="h-11 rounded-2xl border-primary/30 bg-primary/10 text-primary"
                    onClick={() => analyzeFrame(true)}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Reset
                  </Button>
                )}
              </div>

              <div className="mt-2 text-[11px] leading-relaxed text-white/60">
                Finish unlocks once you reach 8 clean reps. Cancel keeps this exercise available to return later.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Camera;

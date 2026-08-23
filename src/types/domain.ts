export type FarmRole = "admin" | "manager" | "worker";
export interface AppContext {
  user: { id: string; email: string };
  profile: { full_name: string | null; phone: string | null } | null;
  membership: { id: string; role: FarmRole; farm_id: string };
  farm: { id: string; name: string; currency: string; timezone: string; crate_size: number; feed_bag_size_kg: number; opening_cash_balance: number };
}
export interface FarmSettings { default_egg_price_per_crate: number; default_loose_egg_price: number; feed_alert_warning_days: number; feed_alert_critical_days: number; average_feed_days_window: number }
export interface Flock { id: string; farm_id: string; flock_name: string; batch_reference: string | null; breed: string | null; house_pen: string | null; start_date: string; initial_birds: number; age_at_arrival_weeks: number | null; source: string | null; status: "active" | "closed" | "sold" | "culled"; notes: string | null }
export interface FlockStatus { flock_id: string; farm_id: string; flock_name: string; initial_birds: number; total_in: number; total_out: number; current_live_birds: number; status: Flock["status"] }
export interface ProductionMetrics { production_id: string; farm_id: string; flock_id: string; production_date: string; eggs_collected: number; cracked_eggs: number; good_eggs: number; live_birds: number; hen_day_percentage: number | null; cracked_percentage: number; feed_consumed_kg: number; feed_per_bird: number | null; feed_per_egg: number | null; deaths: number; culls: number; transport_cost: number; other_cost: number; notes: string | null }

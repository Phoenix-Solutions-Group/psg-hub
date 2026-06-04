import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PricingCardProps = {
  name: string;
  price: number;
  features: string[];
  tier: string;
  current?: boolean;
};

export function PricingCard({
  name,
  price,
  features,
  tier,
  current,
}: PricingCardProps) {
  return (
    <Card className={current ? "border-primary ring-2 ring-primary/20" : ""}>
      <CardHeader>
        <CardTitle className="text-lg">{name}</CardTitle>
        <p className="text-3xl font-bold">
          ${price}
          <span className="text-sm font-normal text-muted-foreground">
            /mo
          </span>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2 text-sm">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <span className="mt-0.5 text-primary">&#10003;</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        {current ? (
          <form action="/api/billing/portal" method="POST">
            <Button variant="outline" className="w-full">
              Manage subscription
            </Button>
          </form>
        ) : (
          <form action="/api/billing/checkout" method="POST">
            <input type="hidden" name="tier" value={tier} />
            <Button className="w-full">Subscribe</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

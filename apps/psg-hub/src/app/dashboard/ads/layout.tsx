export default function AdsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ads</h1>
        <p className="text-muted-foreground">
          Run and monitor Google Ads campaigns for this shop.
        </p>
      </div>
      {children}
    </div>
  );
}

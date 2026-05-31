"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ContentItem = {
  id: string;
  title: string;
  content_type: string;
  status: string;
  updated_at: string;
};

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  published: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatType(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ContentTable({ items }: { items: ContentItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground">No content yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Content will appear here once your agents start producing.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <Link
                href={`/dashboard/content/${item.id}`}
                className="font-medium text-foreground hover:text-primary"
              >
                {item.title}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatType(item.content_type)}
            </TableCell>
            <TableCell>
              <Badge
                variant="secondary"
                className={statusColors[item.status] || ""}
              >
                {formatType(item.status)}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(item.updated_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

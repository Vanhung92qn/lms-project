import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface KnowledgeNodeDto {
  id: string;
  slug: string;
  title: string;
  domain: string;
}

export interface KnowledgeEdgeDto {
  from: string; // slug
  to: string;   // slug
  relation: 'prereq' | 'related';
  weight: number;
}

export interface UserMasteryRowDto {
  node: KnowledgeNodeDto;
  score: number;        // 0..1
  confidence: number;   // 0..1
  attempts: number;
  lastUpdatedAt: Date;
}

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public vocabulary — used by the teacher tagging UI and the student
   * dashboard widget. Filterable by `domain` (e.g. 'cpp' only). */
  async listNodes(domain?: string): Promise<KnowledgeNodeDto[]> {
    const rows = await this.prisma.knowledgeNode.findMany({
      where: domain ? { domain } : undefined,
      orderBy: [{ domain: 'asc' }, { slug: 'asc' }],
    });
    return rows.map((n) => ({ id: n.id, slug: n.slug, title: n.title, domain: n.domain }));
  }

  /** Full graph: nodes + directed edges. Used by the admin KG viewer
   * (P7) and the next-lesson recommender (P5c). */
  async fullGraph(): Promise<{ nodes: KnowledgeNodeDto[]; edges: KnowledgeEdgeDto[] }> {
    const [nodes, edges] = await Promise.all([
      this.prisma.knowledgeNode.findMany(),
      this.prisma.knowledgeEdge.findMany({
        include: { from: { select: { slug: true } }, to: { select: { slug: true } } },
      }),
    ]);
    return {
      nodes: nodes.map((n) => ({ id: n.id, slug: n.slug, title: n.title, domain: n.domain })),
      edges: edges.map((e) => ({
        from: e.from.slug,
        to: e.to.slug,
        relation: e.relation,
        weight: Number(e.weight),
      })),
    };
  }

  /** Current user's mastery row for every node they've touched. Nodes
   * the user has never practiced are not returned — the FE treats them
   * as `score: 0, confidence: 0` implicitly. */
  async listMastery(userId: string): Promise<UserMasteryRowDto[]> {
    const rows = await this.prisma.userMastery.findMany({
      where: { userId },
      include: { node: true },
      orderBy: { score: 'desc' },
    });
    return rows.map((m) => ({
      node: {
        id: m.node.id,
        slug: m.node.slug,
        title: m.node.title,
        domain: m.node.domain,
      },
      score: Number(m.score),
      confidence: Number(m.confidence),
      attempts: m.attempts,
      lastUpdatedAt: m.lastUpdatedAt,
    }));
  }

  /** Return the current node slugs tagged on a lesson. Public because
   * it only exposes knowledge metadata, not enrolment state — the
   * Studio editor calls it to pre-fill the picker, and the lesson
   * player may eventually surface "this lesson covers" chips. */
  async lessonTags(lessonId: string): Promise<string[]> {
    const rows = await this.prisma.lessonKnowledgeNode.findMany({
      where: { lessonId },
      include: { node: { select: { slug: true } } },
    });
    return rows.map((r) => r.node.slug);
  }

  /**
   * Suggest a next lesson for a student who just finished `lessonId`.
   *
   * Walk the course in (module, lesson) order and pick the first lesson
   * after the current one whose knowledge-node prerequisites are all
   * mastered (score ≥ 0.5). If every remaining lesson is gated by a
   * weak prereq, fall back to the immediate next lesson with a flag so
   * the UI can warn the student. Returns null when the student has
   * reached the end of the course.
   */
  async suggestNextLesson(
    userId: string,
    lessonId: string,
  ): Promise<
    | { lessonId: string; title: string; courseSlug: string; gatedByPrereq: boolean }
    | null
  > {
    const current = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        module: {
          select: {
            courseId: true,
            course: { select: { slug: true } },
          },
        },
      },
    });
    if (!current) return null;

    // Flatten every lesson in the course into a stable (module, lesson)
    // order. Could be done with a single ordered query using module.sortOrder
    // + lesson.sortOrder, but Prisma's nested orderBy would need raw SQL.
    const modules = await this.prisma.module.findMany({
      where: { courseId: current.module.courseId },
      orderBy: { sortOrder: 'asc' },
      include: { lessons: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true } } },
    });
    const ordered = modules.flatMap((m) => m.lessons);
    const currentIdx = ordered.findIndex((l) => l.id === lessonId);
    const rest = currentIdx >= 0 ? ordered.slice(currentIdx + 1) : [];
    if (rest.length === 0) return null;

    const masteryRows = await this.prisma.userMastery.findMany({
      where: { userId },
      select: { nodeId: true, score: true },
    });
    const masteryByNode = new Map(masteryRows.map((m) => [m.nodeId, Number(m.score)]));

    for (const cand of rest) {
      const tags = await this.prisma.lessonKnowledgeNode.findMany({
        where: { lessonId: cand.id },
        select: { nodeId: true },
      });
      // Untagged lesson — no gating possible, hand it through.
      if (tags.length === 0) {
        return {
          lessonId: cand.id,
          title: cand.title,
          courseSlug: current.module.course.slug,
          gatedByPrereq: false,
        };
      }
      const prereqs = await this.prisma.knowledgeEdge.findMany({
        where: { relation: 'prereq', toId: { in: tags.map((t) => t.nodeId) } },
        select: { fromId: true },
      });
      const blocked = prereqs.some((e) => (masteryByNode.get(e.fromId) ?? 0) < 0.5);
      if (!blocked) {
        return {
          lessonId: cand.id,
          title: cand.title,
          courseSlug: current.module.course.slug,
          gatedByPrereq: false,
        };
      }
    }

    // All remaining lessons are gated — surface the immediate next with
    // a flag so the UI can show a "you may want to review X first" hint.
    const next = rest[0];
    return {
      lessonId: next.id,
      title: next.title,
      courseSlug: current.module.course.slug,
      gatedByPrereq: true,
    };
  }

  /** Teacher-side: replace the knowledge tags on a lesson. The lesson's
   * owning course teacher_id must match `teacherId`; we throw 404 rather
   * than 403 to avoid leaking lesson existence to non-owners. */
  async tagLesson(
    lessonId: string,
    teacherId: string,
    nodeSlugs: string[],
  ): Promise<{ tagged: string[] }> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { module: { select: { course: { select: { teacherId: true } } } } },
    });
    if (!lesson || lesson.module.course.teacherId !== teacherId) {
      throw new NotFoundException({ code: 'lesson_not_found', message: 'Lesson not found' });
    }

    const nodes =
      nodeSlugs.length === 0
        ? []
        : await this.prisma.knowledgeNode.findMany({
            where: { slug: { in: nodeSlugs } },
            select: { id: true, slug: true },
          });
    if (nodes.length !== nodeSlugs.length) {
      const found = new Set(nodes.map((n) => n.slug));
      const missing = nodeSlugs.filter((s) => !found.has(s));
      throw new NotFoundException({
        code: 'knowledge_node_not_found',
        message: `Unknown knowledge node slug(s): ${missing.join(', ')}`,
      });
    }

    // Replace strategy — simpler than diff'ing, and the join table is tiny.
    await this.prisma.$transaction([
      this.prisma.lessonKnowledgeNode.deleteMany({ where: { lessonId } }),
      ...(nodes.length > 0
        ? [
            this.prisma.lessonKnowledgeNode.createMany({
              data: nodes.map((n) => ({ lessonId, nodeId: n.id })),
            }),
          ]
        : []),
    ]);

    return { tagged: nodes.map((n) => n.slug) };
  }
}

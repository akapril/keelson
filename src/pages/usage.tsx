// 用量页外壳：页头 + 成本控制塔。
// 「额度燃烧」tab 暂隐藏（估算依赖官方未公布的额度、可靠性有限，先只留成本控制塔）；
// 把 SHOW_QUOTA_BURN 改回 true 即恢复双 tab（QuotaBurnTab 组件代码保留、未删）。
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import CostTowerTab from "@/features/usage/CostTowerTab";
import QuotaBurnTab from "@/features/usage/QuotaBurnTab";

// 开关：先隐藏额度燃烧，只显示成本控制塔。恢复时改为 true 即回到双 tab。
const SHOW_QUOTA_BURN: boolean = false;

export default function UsagePage() {
  const { t } = useTranslation("usage");

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 overflow-y-auto p-6">
      <header>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {SHOW_QUOTA_BURN ? (
        // 双 tab：默认「额度燃烧」
        <Tabs defaultValue="quota" className="gap-5">
          <TabsList className="w-fit">
            <TabsTrigger value="quota">{t("tabs.quota")}</TabsTrigger>
            <TabsTrigger value="cost">{t("tabs.cost")}</TabsTrigger>
          </TabsList>

          <TabsContent value="quota">
            <QuotaBurnTab />
          </TabsContent>
          <TabsContent value="cost">
            <CostTowerTab />
          </TabsContent>
        </Tabs>
      ) : (
        // 额度燃烧隐藏时：单视图，直接渲染成本控制塔（不显示单 tab 栏）
        <CostTowerTab />
      )}
    </div>
  );
}

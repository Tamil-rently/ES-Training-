#include<stdio.h>
#include<stdio.h>
int main(){
    int n,x;
    printf("Enter size of array");
    scanf("%d",&n);
    int a[n];
    for(int i=0;i<n;i++){
        scanf("%d",&a[i]);
    }
    for(int i=0;i<n;i++){
        x=x^a[i];
    }
    printf("%d",x);

}